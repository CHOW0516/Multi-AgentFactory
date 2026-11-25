"""Create and verify production inspections."""

from sqlalchemy import select

from app.core.audit import write_audit
from app.models import OrderLine, Part, QcPlan, QcRecord
from app.orchestrator.workflow import lock_order


async def get_plan(session, order_id):
    return await session.scalar(
        select(QcPlan).where(QcPlan.order_id == order_id).order_by(QcPlan.created_at).limit(1)
    )


async def get_records(session, plan):
    return list(
        await session.scalars(
            select(QcRecord).where(QcRecord.qc_plan_id == plan.id).order_by(QcRecord.created_at, QcRecord.id)
        )
    )


async def create_plan(session, order_id):
    if await lock_order(session, order_id) is None:
        raise ValueError("Unknown order")
    plan = await get_plan(session, order_id)
    if plan:
        return plan
    lines = (
        await session.execute(
            select(OrderLine, Part)
            .outerjoin(Part)
            .where(OrderLine.order_id == order_id)
            .order_by(OrderLine.line_number)
        )
    ).all()
    checks = []
    for line, part in lines:
        interval = max(1, part.qc_sample_every or 50) if part else 50
        spec = part.qc_notes if part else None
        name = f"Line {line.line_number}"
        checks.append(dict(name=f"{name}: first piece", kind="first_piece", every_n=None, spec=spec))
        for piece in range(interval, int(line.quantity) + 1, interval):
            if piece != 1:
                checks.append(dict(name=f"{name}: piece {piece}", kind="sample", every_n=interval, spec=spec))
    if not checks:
        checks.append(dict(name="First piece", kind="first_piece", every_n=None, spec=None))
    plan = QcPlan(order_id=order_id, checks=checks)
    session.add(plan)
    await session.flush()
    await write_audit(
        session, "quality", "create_qc_plan", "order", order_id, after={"plan_id": str(plan.id)}
    )
    return plan


async def verify(session, order_id):
    plan = await get_plan(session, order_id)
    if plan is None:
        return ["QC plan"]
    latest = {record.check_name: record.result for record in await get_records(session, plan)}
    return [check["name"] for check in plan.checks if latest.get(check["name"]) != "pass"]
