"""Free everything an order owns when it reaches a closed state.

Runs inside the orchestrator transaction that makes the order closed, so the state change and the
clean-up commit together. Agents also refuse new holds or plans for closed orders (see guards there).
"""

from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.models import PlanOption, PurchaseRequest, ScheduleSlot, StockHold


async def release_order_resources(session: AsyncSession, order_id, reason: str, now: datetime | None = None):
    now = now or datetime.now(UTC)

    # Proposals that were never chosen.
    proposed = list(
        await session.scalars(
            select(PlanOption.id).where(PlanOption.order_id == order_id, PlanOption.status == "proposed")
        )
    )
    if proposed:
        await session.execute(
            delete(ScheduleSlot).where(
                ScheduleSlot.plan_option_id.in_(proposed), ScheduleSlot.status == "tentative"
            )
        )
        await session.execute(
            update(PlanOption).where(PlanOption.id.in_(proposed)).values(status="discarded")
        )

    # Locked machine time: future work is freed, work in progress ends now, past work is done.
    freed = await session.execute(
        delete(ScheduleSlot)
        .where(
            ScheduleSlot.order_id == order_id,
            ScheduleSlot.status == "locked",
            ScheduleSlot.start_at > now,
        )
        .returning(ScheduleSlot.id)
    )
    freed_ids = [str(row) for row in freed.scalars()]
    await session.execute(
        update(ScheduleSlot)
        .where(
            ScheduleSlot.order_id == order_id,
            ScheduleSlot.status == "locked",
            ScheduleSlot.start_at <= now,
            ScheduleSlot.end_at > now,
        )
        .values(end_at=now, status="done")
    )
    await session.execute(
        update(ScheduleSlot)
        .where(ScheduleSlot.order_id == order_id, ScheduleSlot.status == "locked", ScheduleSlot.end_at <= now)
        .values(status="done")
    )

    holds = list(await session.scalars(select(StockHold).where(StockHold.order_id == order_id)))
    for hold in holds:
        await session.delete(hold)

    cancelled = await session.execute(
        update(PurchaseRequest)
        .where(PurchaseRequest.order_id == order_id, PurchaseRequest.status == "draft")
        .values(status="cancelled")
        .returning(PurchaseRequest.id)
    )
    cancelled_ids = [str(row) for row in cancelled.scalars()]

    if freed_ids or holds or cancelled_ids:
        await write_audit(
            session,
            "orchestrator",
            "release_order_resources",
            "order",
            order_id,
            None,
            {
                "reason": reason,
                "freed_slots": freed_ids,
                "released_holds": [
                    {"material_id": str(hold.material_id), "quantity": str(hold.quantity)} for hold in holds
                ],
                "cancelled_purchase_requests": cancelled_ids,
            },
        )
