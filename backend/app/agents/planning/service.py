"""Load planning data, persist proposals, and atomically lock a selected schedule."""

import asyncio
import logging
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.material.service import UNKNOWN_READY_DATE, forecast, order_requirements, requirements
from app.agents.planning.calendar import Window, calendar, overlaps
from app.agents.planning.confidence import SimJob, as_dict, confidence_for
from app.agents.planning.options import HOUR, Candidate, Scenario, propose, slot_snapshot
from app.agents.planning.solver import Job
from app.api.settings import effective_settings
from app.core.audit import write_audit
from app.core.config import settings
from app.models import (
    CLOSED_ORDER_STATES,
    AuditLog,
    Holiday,
    Machine,
    MaintenanceEvent,
    Material,
    Order,
    OrderLine,
    PlanOption,
    Routing,
    ScheduleSlot,
    Shift,
)
from app.schemas.api import WhatIfRequest, WhatIfResult
from app.schemas.contracts import (
    PlanOrderResult,
    RecheckResult,
    ReplanForMachinePayload,
    ReplanForMachineResult,
)

logger = logging.getLogger(__name__)
FAR_FUTURE = datetime.max.replace(tzinfo=UTC)


async def serialize_writes(session: AsyncSession) -> None:
    # Keep approval writes serial even if another planning process is accidentally started.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('agent.planning.schedule', 0))")
    )


async def maintenance_windows(
    session: AsyncSession,
    machines: list[Machine],
    start: datetime,
    end: datetime = FAR_FUTURE,
) -> dict[UUID, list[Window]]:
    rows = await session.scalars(
        select(MaintenanceEvent).where(
            MaintenanceEvent.machine_id.in_([machine.id for machine in machines]),
            MaintenanceEvent.start_at < end,
            or_(MaintenanceEvent.end_at.is_(None), MaintenanceEvent.end_at > start),
        )
    )
    blocks: dict[UUID, list[Window]] = defaultdict(list)
    for row in rows:
        blocks[row.machine_id].append((row.start_at, row.end_at or FAR_FUTURE))
    for machine in machines:
        if machine.status in {"down", "maintenance"} and not any(
            left <= start < right for left, right in blocks[machine.id]
        ):
            blocks[machine.id].append((start, FAR_FUTURE))
    return dict(blocks)


async def load_scenario(
    session: AsyncSession,
    items: list[tuple[UUID, Decimal]],
    ready: date,
    due: date | None,
    *,
    order: Order | None = None,
    outage: ReplanForMachinePayload | None = None,
) -> Scenario:
    # Round up to a minute so a result published at the current instant can still be locked.
    actual_now = datetime.now(UTC)
    now = actual_now.replace(second=0, microsecond=0) + timedelta(minutes=1)
    routes: dict[UUID, list[Routing]] = defaultdict(list)
    for row in await session.scalars(
        select(Routing).where(Routing.part_id.in_({item[0] for item in items})).order_by(Routing.step_number)
    ):
        if row.setup_minutes < 0 or row.cycle_seconds_per_part < 0:
            raise ValueError("Routings require non-negative setup and cycle times")
        routes[row.part_id].append(row)
    machines = list(await session.scalars(select(Machine).order_by(Machine.code)))
    maintenance = await maintenance_windows(session, machines, now)
    if outage:
        maintenance.setdefault(outage.machine_id, []).append(
            (outage.unavailable_from, outage.unavailable_to or FAR_FUTURE)
        )
    locked = list(
        await session.scalars(
            select(ScheduleSlot).where(
                ScheduleSlot.status == "locked",
                ScheduleSlot.end_at > actual_now,
            )
        )
    )
    replaces, remaining, blocked_reason, late_until = [], None, None, None
    if order and outage and outage.late_order_id == order.id:
        # This order's running job is late: its next steps cannot start before that job ends.
        late_until = outage.unavailable_to
    if order:
        # Own future slots can be replaced by an approved replan. Active slots retain their capacity.
        replaces = [slot for slot in locked if slot.order_id == order.id and slot.start_at >= now]
        replace_ids = {slot.id for slot in replaces}
        locked = [slot for slot in locked if slot.id not in replace_ids]
        if outage is not None or replaces or order.status == "IN_PRODUCTION":
            history = await session.scalar(
                select(ScheduleSlot.id)
                .where(
                    ScheduleSlot.order_id == order.id,
                    or_(
                        ScheduleSlot.status == "done",
                        (ScheduleSlot.status == "locked") & (ScheduleSlot.start_at <= actual_now),
                    ),
                )
                .limit(1)
            )
            if history is not None or order.status == "IN_PRODUCTION":
                remaining = replaces
                if outage and any(
                    slot.order_id == order.id
                    and slot.machine_id == outage.machine_id
                    and slot.start_at <= actual_now
                    and overlaps(
                        (slot.start_at, slot.end_at),
                        (outage.unavailable_from, outage.unavailable_to or FAR_FUTURE),
                    )
                    for slot in locked
                ):
                    blocked_reason = "an interrupted operation requires a production count before replanning"
    other_ids = {slot.order_id for slot in locked}
    other_orders = {
        row.id: row for row in await session.scalars(select(Order).where(Order.id.in_(other_ids)))
    }
    return Scenario(
        zone=ZoneInfo(settings.app_timezone),
        now=now,
        ready_date=ready,
        due_date=due,
        machines=machines,
        shifts=list(await session.scalars(select(Shift))),
        holidays=set(await session.scalars(select(Holiday.holiday_date))),
        maintenance=maintenance,
        locked=locked,
        jobs=[Job(quantity, routes[part_id]) for part_id, quantity in items],
        config=await effective_settings(session),
        orders=other_orders,
        replaces=replaces,
        remaining=remaining,
        blocked_reason=blocked_reason,
        target=order,
        late_until=late_until,
    )


def skipped_text(reasons: dict[str, str]) -> str:
    if not reasons:
        return ""
    return (
        " Other options were skipped because "
        + "; ".join(f"{kind.replace('_', ' ')}: {reason}" for kind, reason in reasons.items())
        + "."
    )


def explanation_parts(
    candidate: Candidate,
    margin: Decimal,
    missing_costs: list[str],
    reasons: dict[str, str],
) -> tuple[str, str]:
    """The delivery sentence and the computed details that follow the option sentence."""
    ready = f"The full order can ship by {candidate.finish_date:%d %B %Y}."
    if candidate.first_finish and candidate.first_quantity is not None:
        ready = (
            f"The first {candidate.first_quantity.normalize():f} units can ship by "
            f"{candidate.first_finish:%d %B %Y} and the rest by {candidate.finish_date:%d %B %Y}."
        )
    detail = []
    if candidate.overtime_seconds:
        detail.append(
            f"Overtime is {candidate.overtime_seconds / HOUR:.2f} hours, costing "
            f"{candidate.extra_cost:.2f} {settings.currency}."
        )
    if candidate.impacted:
        detail.append(f"This option moves {len(candidate.impacted)} other order(s).")
    if missing_costs:
        detail.append("Material cost was estimated as zero for " + ", ".join(missing_costs) + ".")
    if not candidate.optimal:
        detail.append("The solver returned a feasible schedule before it could establish optimality.")
    tail = (" " + " ".join(detail) if detail else "") + skipped_text(reasons)
    return ready, tail


# One plain sentence per option type. These replaced an AI call per option: the AI was not allowed
# to use numbers or dates, so it only reworded what these sentences say, at a cost on every plan.
OPTION_SENTENCES = {
    "as_requested": "This plan meets the requested date with normal shifts.",
    "delay": "This is the earliest date the current machine time and material allow.",
    "split": "This plan ships part of the order early and the rest later.",
    "overtime": "This plan meets the date by adding overtime.",
    "move_other_order": "This plan meets the date by moving other orders later.",
}


def explanation_text(
    candidate: Candidate, margin: Decimal, missing_costs: list[str], reasons: dict[str, str]
) -> str:
    ready, tail = explanation_parts(candidate, margin, missing_costs, reasons)
    sentence = OPTION_SENTENCES.get(candidate.kind)
    return ready + (" " + sentence if sentence else "") + tail


async def clear_proposals(session: AsyncSession, order_id: UUID, option_id: UUID | None = None) -> None:
    query = select(PlanOption.id).where(PlanOption.order_id == order_id, PlanOption.status == "proposed")
    if option_id is not None:
        query = query.where(PlanOption.id == option_id)
    ids = list(await session.scalars(query))
    if ids:
        await session.execute(
            delete(ScheduleSlot).where(
                ScheduleSlot.plan_option_id.in_(ids),
                ScheduleSlot.status == "tentative",
            )
        )
        await session.execute(update(PlanOption).where(PlanOption.id.in_(ids)).values(status="discarded"))


async def plan_order(
    session: AsyncSession,
    order_id: UUID,
    material_ready_date: date | None,
    task_id: UUID | None = None,
    *,
    outage: ReplanForMachinePayload | None = None,
) -> PlanOrderResult:
    await serialize_writes(session)
    if task_id is not None:
        audit = await cached_task(session, "plan_order", order_id, task_id)
        if audit:
            return PlanOrderResult.model_validate(audit.after["result"])

    order = await session.get(Order, order_id)
    if order is None:
        raise ValueError("Order not found")
    if order.status in CLOSED_ORDER_STATES:
        raise ValueError(f"Order is {order.status}; it is not planned")
    lines = list(
        await session.scalars(
            select(OrderLine)
            .where(OrderLine.order_id == order_id)
            .order_by(OrderLine.line_number, OrderLine.id)
        )
    )
    if not lines or any(line.part_id is None or line.quantity <= 0 for line in lines):
        raise ValueError("Order requires verified lines with parts and positive quantities")
    items = [(line.part_id, line.quantity) for line in lines]
    # The scheduler uses date.max for "material date unknown"; it then offers no promised option.
    scenario = await load_scenario(
        session, items, material_ready_date or date.max, order.due_date, order=order, outage=outage
    )
    candidates, reasons = await asyncio.to_thread(propose, scenario)

    needed = await requirements(session, items)
    materials = list(
        await session.scalars(select(Material).where(Material.id.in_(needed)).order_by(Material.code))
    )
    material_cost = sum(needed[row.id] * (row.unit_cost or 0) for row in materials)
    missing_costs = [row.code for row in materials if row.unit_cost is None]
    revenue = sum(line.quantity * (line.unit_price or 0) for line in lines)
    ids, recommended_id = [], None
    await clear_proposals(session, order_id)
    for candidate in candidates:
        margin = (revenue - material_cost - candidate.extra_cost).quantize(Decimal("0.01"))
        option = PlanOption(
            order_id=order_id,
            option_type=candidate.kind,
            finish_date=candidate.finish_date,
            split_quantity_first=candidate.first_quantity,
            split_finish_date_first=candidate.first_finish,
            overtime_hours=(candidate.overtime_seconds / HOUR).quantize(Decimal("0.01")),
            extra_cost=candidate.extra_cost,
            margin=margin,
            machine_load=candidate.load,
            impacted_orders=candidate.impacted,
            explanation=None,
            is_recommended=candidate.recommended,
            status="proposed",
        )
        option.explanation = explanation_text(candidate, margin, missing_costs, reasons)
        session.add(option)
        await session.flush()
        displaced = {
            UUID(row["id"]): UUID(impact["order_id"])
            for impact in candidate.impacted
            for row in impact["source_slots"]
        }
        for slot in candidate.placements:
            session.add(
                ScheduleSlot(
                    plan_option_id=option.id,
                    order_id=displaced.get(slot.source_id, order_id),
                    machine_id=slot.machine_id,
                    routing_step=slot.step,
                    quantity=slot.quantity,
                    start_at=slot.start,
                    end_at=slot.end,
                    status="tentative",
                    is_overtime=slot.overtime,
                )
            )
        ids.append(option.id)
        if candidate.recommended:
            recommended_id = option.id
    result = PlanOrderResult(
        plan_option_ids=ids,
        recommended_option_id=recommended_id,
        can_meet_due_date=any(
            order.due_date and candidate.finish_date <= order.due_date for candidate in candidates
        ),
    )
    await write_audit(
        session,
        "planning",
        "plan_order",
        "orders",
        order_id,
        None,
        {
            "task_id": str(task_id) if task_id else None,
            "result": result.model_dump(mode="json"),
            "skipped": reasons,
            "replaced_slots": [slot_snapshot(slot) for slot in scenario.replaces],
        },
    )
    return result


async def cached_task(session: AsyncSession, action: str, entity_id: UUID, task_id: UUID) -> AuditLog | None:
    return await session.scalar(
        select(AuditLog)
        .where(
            AuditLog.agent == "planning",
            AuditLog.action == action,
            AuditLog.entity_id == str(entity_id),
            AuditLog.after["task_id"].as_string() == str(task_id),
        )
        .limit(1)
    )


async def option_slots(session: AsyncSession, option_id: UUID) -> list[ScheduleSlot]:
    return list(
        await session.scalars(
            select(ScheduleSlot)
            .where(ScheduleSlot.plan_option_id == option_id)
            .order_by(ScheduleSlot.start_at, ScheduleSlot.id)
        )
    )


async def validate_plan(
    session: AsyncSession,
    order_id: UUID,
    option: PlanOption,
    slots: list[ScheduleSlot],
) -> tuple[list[str], list[ScheduleSlot]]:
    if option.status != "proposed" or not slots or any(slot.status != "tentative" for slot in slots):
        return ["The selected plan has no active tentative schedule."], []
    now = datetime.now(UTC)
    changes = []
    if any(slot.start_at < now for slot in slots):
        changes.append("The tentative schedule starts in the past.")
    start, end = min(slot.start_at for slot in slots), max(slot.end_at for slot in slots)
    machine_ids = {slot.machine_id for slot in slots}
    machines = list(
        await session.scalars(select(Machine).where(Machine.id.in_(machine_ids)).order_by(Machine.id))
    )
    maintenance = await maintenance_windows(session, machines, min(start, now), end)
    locked = list(
        await session.scalars(
            select(ScheduleSlot).where(
                ScheduleSlot.status == "locked",
                or_(ScheduleSlot.machine_id.in_(machine_ids), ScheduleSlot.order_id == order_id),
                ScheduleSlot.end_at > min(start, now),
            )
        )
    )
    saved = {
        UUID(row["id"]): row for impact in option.impacted_orders for row in impact.get("source_slots", [])
    }
    audit = await session.scalar(
        select(AuditLog)
        .where(
            AuditLog.agent == "planning",
            AuditLog.action == "plan_order",
            AuditLog.entity_id == str(order_id),
            AuditLog.after["result"]["plan_option_ids"].contains([str(option.id)]),
        )
        .limit(1)
    )
    if audit is not None:
        saved.update({UUID(row["id"]): row for row in audit.after.get("replaced_slots", [])})
    actual = {slot.id: slot for slot in locked}
    for slot_id, snapshot in saved.items():
        found = actual.get(slot_id)
        if found is None or found.start_at <= now or slot_snapshot(found) != snapshot:
            changes.append(f"Schedule slot {slot_id} changed before it could be replaced.")
    if any(slot.order_id == order_id and slot.start_at > now and slot.id not in saved for slot in locked):
        changes.append("This order acquired new locked work after this plan was prepared.")
    replace = [slot for slot in locked if slot.id in saved]
    replaced_ids = {slot.id for slot in replace}
    retained: dict[UUID, list[Window]] = defaultdict(list)
    for slot in locked:
        if slot.id not in replaced_ids:
            retained[slot.machine_id].append((slot.start_at, slot.end_at))

    shifts = list(await session.scalars(select(Shift)))
    holidays = set(await session.scalars(select(Holiday.holiday_date)))
    regular, extra = calendar(start, end, ZoneInfo(settings.app_timezone), shifts, holidays)
    for slot in slots:
        slot_window = (slot.start_at, slot.end_at)
        if not any(
            left <= slot.start_at and slot.end_at <= right
            for left, right in (extra if slot.is_overtime else regular)
        ):
            changes.append(f"Calendar changed for machine {slot.machine_id}.")
        if any(overlaps(slot_window, window) for window in maintenance.get(slot.machine_id, [])):
            changes.append(f"Machine {slot.machine_id} is unavailable during a proposed slot.")
        if any(overlaps(slot_window, window) for window in retained[slot.machine_id]):
            changes.append(f"Another order took a proposed slot on machine {slot.machine_id}.")
    return list(dict.fromkeys(changes)), replace


async def recheck_plan(session: AsyncSession, order_id: UUID, option_id: UUID) -> RecheckResult:
    option = await session.get(PlanOption, option_id)
    if option is None or option.order_id != order_id:
        changes = ["The selected plan option was not found."]
    else:
        changes, _ = await validate_plan(session, order_id, option, await option_slots(session, option_id))
    result = RecheckResult(valid=not changes, changes=changes)
    await write_audit(
        session,
        "planning",
        "recheck_plan",
        "orders",
        order_id,
        None,
        {"plan_option_id": str(option_id), **result.model_dump(mode="json")},
    )
    return result


async def lock_plan(session: AsyncSession, order_id: UUID, option_id: UUID | None = None) -> None:
    await serialize_writes(session)
    if option_id is None:
        option_id = await session.scalar(
            select(PlanOption.id)
            .where(
                PlanOption.order_id == order_id,
                PlanOption.is_recommended.is_(True),
                PlanOption.status.in_(["proposed", "chosen"]),
            )
            .order_by(PlanOption.created_at.desc(), PlanOption.id)
            .limit(1)
        )
    option = await session.get(PlanOption, option_id) if option_id else None
    if option is None or option.order_id != order_id:
        raise ValueError("Selected plan option was not found")
    target = await session.get(Order, order_id)
    if target is None or target.status in CLOSED_ORDER_STATES:
        raise ValueError("The order is closed; its plan cannot be locked")
    if option.status == "chosen":
        return
    slots = await option_slots(session, option.id)
    changes, replace = await validate_plan(session, order_id, option, slots)
    if changes:
        raise ValueError("; ".join(changes))
    for slot in replace:
        await session.delete(slot)
    for slot in slots:
        slot.status = "locked"
    await session.execute(
        update(PlanOption)
        .where(
            PlanOption.order_id == order_id,
            PlanOption.status == "chosen",
        )
        .values(status="discarded")
    )
    option.status = "chosen"
    await session.flush()
    await clear_proposals(session, order_id)
    order = await session.get(Order, order_id, with_for_update={"key_share": True})
    old_finish = order.promised_date
    order.promised_date = option.finish_date
    await write_audit(
        session,
        "planning",
        "lock_plan",
        "orders",
        order_id,
        {"promised_date": str(old_finish) if old_finish is not None else None},
        {
            "plan_option_id": str(option.id),
            "promised_date": str(option.finish_date),
            "replaced_slots": [str(slot.id) for slot in replace],
        },
    )
    for impact in option.impacted_orders:
        moved = await session.get(Order, UUID(impact["order_id"]), with_for_update={"key_share": True})
        if moved:
            old_finish = moved.promised_date
            moved.promised_date = date.fromisoformat(impact["new_finish"])
            await write_audit(
                session,
                "planning",
                "move_locked_order",
                "orders",
                moved.id,
                {"promised_date": str(old_finish) if old_finish is not None else None},
                {"promised_date": impact["new_finish"], "plan_option_id": str(option.id)},
            )


async def release_plan(session: AsyncSession, order_id: UUID, option_id: UUID | None = None) -> None:
    await serialize_writes(session)
    await clear_proposals(session, order_id, option_id)
    await write_audit(
        session,
        "planning",
        "release_plan",
        "orders",
        order_id,
        None,
        {"plan_option_id": str(option_id) if option_id else None},
    )


async def late_job_needs_decision(session: AsyncSession, option_ids: list[UUID]) -> bool:
    """A late job only needs the manager when the order can no longer meet its due date with normal shifts.

    No options means there is no unstarted work to move, so there is nothing to decide either.
    """
    if not option_ids:
        return False
    kinds = set(await session.scalars(select(PlanOption.option_type).where(PlanOption.id.in_(option_ids))))
    return "as_requested" not in kinds


async def replan_for_machine(
    session: AsyncSession,
    payload: ReplanForMachinePayload,
    task_id: UUID | None = None,
) -> ReplanForMachineResult:
    await serialize_writes(session)
    machine_id = payload.machine_id
    if task_id is not None:
        audit = await cached_task(session, "replan_for_machine", machine_id, task_id)
        if audit:
            return ReplanForMachineResult.model_validate(audit.after["result"])
    order_ids = list(
        await session.scalars(
            select(ScheduleSlot.order_id)
            .where(
                ScheduleSlot.machine_id == machine_id,
                ScheduleSlot.status.in_(["locked", "tentative"]),
                ScheduleSlot.end_at > payload.unavailable_from,
                ScheduleSlot.start_at < (payload.unavailable_to or FAR_FUTURE),
            )
            .distinct()
            .order_by(ScheduleSlot.order_id)
        )
    )
    late_order_id = payload.late_order_id
    if late_order_id is not None and late_order_id not in order_ids:
        order_ids.append(late_order_id)
    by_order = {}
    for order_id in order_ids:
        needed = await order_requirements(session, order_id)
        report = await forecast(session, needed, order_id=order_id)
        result = await plan_order(session, order_id, report.ready_date, outage=payload)
        if late_order_id is not None and not await late_job_needs_decision(session, result.plan_option_ids):
            await clear_proposals(session, order_id)
            continue
        by_order[str(order_id)] = result.plan_option_ids
    affected = [order_id for order_id in order_ids if str(order_id) in by_order]
    result = ReplanForMachineResult(affected_order_ids=affected, plan_option_ids_by_order=by_order)
    await write_audit(
        session,
        "planning",
        "replan_for_machine",
        "machines",
        machine_id,
        None,
        {
            "task_id": str(task_id) if task_id else None,
            "result": result.model_dump(mode="json"),
        },
    )
    return result


async def what_if(session: AsyncSession, request: WhatIfRequest) -> WhatIfResult:
    quantity = request.quantity
    if (
        quantity <= 0
        or quantity >= Decimal("100000000000")
        or quantity != quantity.quantize(Decimal("0.001"))
    ):
        raise ValueError("Quantity must be positive with at most three decimal places")
    items = [(request.part_id, quantity)]
    report = await forecast(session, await requirements(session, items))
    if report.ready_date == UNKNOWN_READY_DATE:
        raise ValueError("A material shortage has no supplier lead time")
    scenario = await load_scenario(session, items, report.ready_date, request.due_date)
    options, reasons = await asyncio.to_thread(propose, scenario, what_if=True)
    if not options:
        raise ValueError(next(iter(reasons.values()), "No schedule could be found"))
    candidate = options[0]
    prefix = (
        "Earliest delivery"
        if candidate.optimal
        else "Best feasible delivery found within the solver time limit"
    )
    confidence = await confidence_for(
        session,
        [SimJob(row.machine_id, row.step, row.start, row.end, True) for row in candidate.placements],
        request.due_date,
        f"{request.part_id}-{quantity}-{request.due_date}",
    )
    return WhatIfResult(
        can_meet_due_date=candidate.finish_date <= request.due_date,
        earliest_finish_date=candidate.finish_date,
        material_ready_date=report.ready_date,
        explanation=f"{prefix} is {candidate.finish_date:%d %B %Y}.",
        confidence=as_dict(confidence),
    )
