"""Test scenarios on top of the demo seed: orders in every important state, so people can test the app.

Run: python -m app.simulator seed --reset --scenarios

What it adds (see TEST_SCENARIOS.md for how to test each one):
- 4 orders running on the floor now (lathes, laser and press brake busy), one with a QC fail and scrap,
  one almost done with QC passed.
- Orders waiting for approval (one easy, one with a tight date, one short of material, one waiting 9 hours),
  plus approved, customer-replied, declined, sent-back-for-replan, needs-field-check and failed orders.
- Material shortages with purchase requests, a broken-down mill, planned maintenance on the press brake,
  a past breakdown, an accepted and an expired quotation.

Orders that go through planning use the real agent code (material check, planning, approval, lock, QC plan,
customer reply), so their data is the same as the app would make. The AI is never called while seeding.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.agents import quality
from app.agents.material import service as material
from app.agents.order.customer import draft_customer_reply
from app.agents.order.extraction import FieldValue, PurchaseLine, PurchaseOrder, field_rows, reconcile
from app.agents.order.intake import document_path, write_attachment
from app.agents.planning import service as planning
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import session_scope
from app.models import (
    Approval,
    BomLine,
    Customer,
    CustomerMessage,
    Machine,
    MachineEvent,
    MaintenanceEvent,
    Material,
    Order,
    OrderLine,
    Part,
    PlanOption,
    PurchaseRequest,
    QcRecord,
    Quotation,
    Routing,
    ScheduleSlot,
    SourceDocument,
    StockMovement,
    Supplier,
    User,
    WorkflowRun,
)
from app.orchestrator import workflow
from app.simulator.po_documents import DemoPurchaseOrder, render_pdf

logger = logging.getLogger(__name__)

SCENARIO_PO_PREFIX = "TEST"


@dataclass
class Context:
    session: object
    now: datetime
    zone: ZoneInfo
    machines: dict[str, Machine]
    users: dict[str, User]
    counter: int = 0

    def local_datetime(self, day: date, hour: int) -> datetime:
        return datetime.combine(day, time(hour), tzinfo=self.zone).astimezone(UTC)

    def working_day(self, days_ahead: int) -> date:
        """The date `days_ahead` working days (Mon-Fri) from today."""
        day = self.now.astimezone(self.zone).date()
        while days_ahead > 0:
            day += timedelta(days=1)
            if day.weekday() < 5:
                days_ahead -= 1
        return day


# ---------------------------------------------------------------- picking parts
async def _routing_types(session, part_id) -> list[str]:
    steps = await session.scalars(
        select(Routing).where(Routing.part_id == part_id).order_by(Routing.step_number)
    )
    return [step.machine_type for step in steps]


async def _parts_by_kind(session) -> dict[str, list[Part]]:
    """lathe = lathe only, mill = lathe and mill, sheet = laser and press brake."""
    kinds: dict[str, list[Part]] = {"lathe": [], "mill": [], "sheet": []}
    for part in await session.scalars(select(Part).order_by(Part.part_number)):
        types = await _routing_types(session, part.id)
        if "laser_cutter" in types:
            kinds["sheet"].append(part)
        elif "cnc_mill" in types:
            kinds["mill"].append(part)
        else:
            kinds["lathe"].append(part)
    return kinds


async def _open_quote(session, part: Part) -> Quotation | None:
    return await session.scalar(
        select(Quotation).where(Quotation.part_id == part.id, Quotation.status == "open").limit(1)
    )


class PartPicker:
    """Hands out each part once, preferring parts with (or without) an open quotation."""

    def __init__(self, parts_by_kind: dict[str, list[Part]]):
        self.parts_by_kind = parts_by_kind
        self.used: set[uuid.UUID] = set()

    async def take(self, session, kind: str, with_quote: bool | None = None) -> Part:
        for part in self.parts_by_kind[kind]:
            if part.id in self.used:
                continue
            if with_quote is not None and (await _open_quote(session, part) is not None) != with_quote:
                continue
            self.used.add(part.id)
            return part
        # fall back to any unused part of that kind
        for part in self.parts_by_kind[kind]:
            if part.id not in self.used:
                self.used.add(part.id)
                return part
        raise RuntimeError(f"No {kind} part left for the test scenarios")

    async def take_lightest_quoted(self, session) -> Part:
        """The unused part whose open quotation needs the fewest machine hours."""
        best, best_seconds = None, None
        for parts in self.parts_by_kind.values():
            for part in parts:
                quote = await _open_quote(session, part)
                if part.id in self.used or quote is None:
                    continue
                steps = await session.scalars(select(Routing).where(Routing.part_id == part.id))
                seconds = sum(
                    step.setup_minutes * 60 + step.cycle_seconds_per_part * quote.quantity for step in steps
                )
                if best_seconds is None or seconds < best_seconds:
                    best, best_seconds = part, seconds
        if best is None:
            raise RuntimeError("No quoted part left for the test scenarios")
        self.used.add(best.id)
        return best


# ---------------------------------------------------------------- order intake (no AI)
async def _receive(
    ctx: Context,
    part: Part,
    quantity: int,
    due_date: date,
    *,
    unit_price: Decimal | None = None,
    revision: str | None = None,
    layout: str = "classic_table",
    created_hours_ago: float = 1,
    low_confidence: tuple[str, ...] = (),
    notes: str | None = None,
) -> tuple[Order, WorkflowRun]:
    """Creates the PO PDF, the order and its extracted fields the way the Order agent does.

    The extraction values are written here instead of asking the AI; then the real reconcile code links
    customer, part and quotation and flags anything that needs a check.
    """
    session = ctx.session
    ctx.counter += 1
    customer = await session.get(Customer, part.customer_id)
    quote = await _open_quote(session, part)
    if unit_price is None:
        unit_price = quote.unit_price if quote else Decimal("12.50")
    po = DemoPurchaseOrder(
        customer_name=customer.name,
        customer_code=customer.code,
        customer_address=customer.address or "",
        po_number=f"{customer.code}-{SCENARIO_PO_PREFIX}-{ctx.counter:03d}",
        part_number=part.part_number,
        revision=revision or part.revision,
        description=part.description or part.part_number,
        quantity=quantity,
        unit_price=unit_price,
        due_date=due_date,
        layout=layout,
        currency=settings.currency,
        due_date_text=due_date.strftime("%d %b %Y"),
    )
    created_at = ctx.now - timedelta(hours=created_hours_ago)
    document_id, order_id = uuid.uuid4(), uuid.uuid4()
    stored_path = f"{document_id.hex}.pdf"
    write_attachment(document_path(stored_path), render_pdf(po))
    document = SourceDocument(
        id=document_id,
        file_path=stored_path,
        file_name=f"{po.po_number}.pdf",
        mime_type="application/pdf",
        email_from=customer.email,
        email_subject=f"Purchase Order {po.po_number}",
        email_message_id=f"<{document_id}@{customer.code.lower()}.example>",
    )
    document.created_at = created_at
    session.add(document)
    await session.flush()
    order = Order(
        id=order_id,
        order_number=f"SO-{ctx.now.year}-T{ctx.counter:03d}",
        source_document_id=document_id,
        status="RECEIVED",
    )
    order.created_at = created_at
    session.add(order)
    await session.flush()

    def field(name: str, value: str | None, source: str | None = None) -> FieldValue:
        confidence = 0.55 if name in low_confidence else 0.97
        return FieldValue(value=value, confidence=confidence, source_text=source or value)

    extraction = PurchaseOrder(
        customer_name=field("customer_name", customer.name),
        po_number=field("po_number", po.po_number),
        po_revision=field("po_revision", None),
        lines=[
            PurchaseLine(
                part_number=field("lines[0].part_number", po.part_number),
                revision=field("lines[0].revision", po.revision),
                quantity=field("lines[0].quantity", str(quantity)),
                unit_price=field("lines[0].unit_price", str(unit_price)),
            )
        ],
        due_date=field("due_date", due_date.isoformat(), po.due_date_text),
        delivery_address=field("delivery_address", customer.address),
        notes=field("notes", notes),
    )
    rows = field_rows(order.id, extraction)
    # rows carry the field names reconcile looks for; low_confidence names are matched exactly
    reconciled = await reconcile(session, order, rows)
    session.add_all(rows + reconciled.lines)
    await write_audit(
        session,
        "order",
        "extract_document",
        "orders",
        order.id,
        None,
        {
            "result": {
                "order_id": str(order.id),
                "fields_needing_check": [row.field_name for row in rows if row.needs_check],
                "quotation_mismatches": [
                    mismatch.model_dump(mode="json") for mismatch in reconciled.mismatches
                ],
            },
            "seeded": True,
        },
    )
    run = WorkflowRun(order_id=order.id, state="RECEIVED", attempts={})
    session.add(run)
    await session.flush()
    return order, run


async def _plan(ctx: Context, order: Order, run: WorkflowRun) -> list[uuid.UUID]:
    """RECEIVED -> ... -> PLANNED with the real material check and planner. Returns plan option ids."""
    session = ctx.session
    for state in ("EXTRACTED", "VERIFIED"):
        await workflow.transition(session, order, run, state)
    check = await material.check_and_hold(session, order.id)
    await workflow.transition(session, order, run, "MATERIAL_CHECKED")
    result = await planning.plan_order(session, order.id, check.material_ready_date)
    await workflow.transition(session, order, run, "PLANNED")
    return list(result.plan_option_ids)


async def _wait_for_approval(
    ctx: Context, order: Order, run: WorkflowRun, waiting_hours: float = 0.5
) -> Approval:
    option_ids = await _plan(ctx, order, run)
    await workflow.create_approval(ctx.session, order, run, option_ids)
    approval = await ctx.session.scalar(
        select(Approval).where(Approval.order_id == order.id, Approval.status == "waiting")
    )
    approval.created_at = ctx.now - timedelta(hours=waiting_hours)
    return approval


async def _recommended_option(session, order: Order) -> PlanOption:
    options = list(
        await session.scalars(
            select(PlanOption).where(PlanOption.order_id == order.id, PlanOption.status == "proposed")
        )
    )
    return next((option for option in options if option.is_recommended), options[0])


async def _decide(
    ctx: Context, approval: Approval, decision: str, reject_reason=None, comment=None, option=None
):
    approval.status = "decided"
    approval.decision = decision
    approval.reject_reason = reject_reason
    approval.comment = comment
    approval.chosen_option_id = option.id if option else None
    approval.approver_id = ctx.users["manager"].id
    approval.decided_at = ctx.now - timedelta(minutes=30)
    await write_audit(
        ctx.session,
        ctx.users["manager"],
        "decide_approval",
        "approvals",
        approval.id,
        None,
        {"decision": decision, "reject_reason": reject_reason, "comment": comment},
    )


async def _approve_and_reply(ctx: Context, order: Order, run: WorkflowRun) -> None:
    """WAITING_APPROVAL -> approved -> CONFIRMED -> REPLY_DRAFTED, like the orchestrator does."""
    session = ctx.session
    approval = await _wait_for_approval(ctx, order, run, waiting_hours=3)
    option = await _recommended_option(session, order)
    await _decide(ctx, approval, "approve", option=option)
    workflow.update(run, selected_option=option.id, approval_type="order", recheck_changes=[])
    await workflow.transition(session, order, run, "RECHECKING")
    await material.confirm_holds(session, order.id)
    await planning.lock_plan(session, order.id, option.id)
    await material.create_purchase_requests(session, order.id)
    await workflow.transition(session, order, run, "CONFIRMED")
    await quality.create_plan(session, order.id)
    await draft_customer_reply(session, order.id, option.id)
    await workflow.transition(session, order, run, "REPLY_DRAFTED")
    if order.quotation_id:
        quote = await session.get(Quotation, order.quotation_id)
        quote.status = "accepted"


# ---------------------------------------------------------------- running orders (hand-built)
async def _running_order(
    ctx: Context,
    part: Part,
    quantity: int,
    *,
    current_step: int,
    machine_codes: dict[str, str],
    started_hours_ago: float,
    hours_left: float,
    created_days_ago: int,
    due_in_working_days: int,
) -> Order:
    """An order already on the floor: earlier steps done, `current_step` (0-based) running now,
    later steps locked in the future. Materials are issued; machines show running with part counts."""
    session = ctx.session
    order, run = await _receive(
        ctx,
        part,
        quantity,
        ctx.working_day(due_in_working_days),
        created_hours_ago=created_days_ago * 24,
    )
    steps = list(
        await session.scalars(select(Routing).where(Routing.part_id == part.id).order_by(Routing.step_number))
    )
    option = PlanOption(
        order_id=order.id,
        option_type="as_requested",
        finish_date=order.due_date,
        machine_load={},
        impacted_orders=[],
        explanation="Seeded running order.",
        is_recommended=True,
        status="chosen",
    )
    session.add(option)
    await session.flush()

    def hours_for(step: Routing) -> float:
        # real duration, kept between 1 and 12 hours so the floor stays readable
        seconds = step.setup_minutes * 60 + float(step.cycle_seconds_per_part) * quantity
        return min(max(seconds / 3600, 1.0), 12.0)

    current_start = ctx.now - timedelta(hours=started_hours_ago)
    windows: dict[int, tuple[datetime, datetime]] = {}
    windows[current_step] = (current_start, ctx.now + timedelta(hours=hours_left))
    cursor = current_start
    for index in range(current_step - 1, -1, -1):
        end = cursor - timedelta(minutes=30)
        windows[index] = (end - timedelta(hours=hours_for(steps[index])), end)
        cursor = windows[index][0]
    cursor = windows[current_step][1]
    for index in range(current_step + 1, len(steps)):
        start = cursor + timedelta(minutes=30)
        windows[index] = (start, start + timedelta(hours=hours_for(steps[index])))
        cursor = windows[index][1]

    for index, step in enumerate(steps):
        start, end = windows[index]
        machine = ctx.machines[
            machine_codes.get(step.machine_type) or _first_machine_code(ctx, step.machine_type)
        ]
        done = end <= ctx.now
        session.add(
            ScheduleSlot(
                order_id=order.id,
                plan_option_id=option.id,
                machine_id=machine.id,
                routing_step=step.step_number,
                quantity=Decimal(quantity),
                start_at=start,
                end_at=end,
                status="done" if done else "locked",
            )
        )
        if done:
            session.add(
                MachineEvent(
                    machine_id=machine.id,
                    event_type="count",
                    value=str(quantity),
                    order_id=order.id,
                    happened_at=end,
                )
            )
        elif start <= ctx.now:
            progress = (ctx.now - start) / (end - start)
            session.add(
                MachineEvent(
                    machine_id=machine.id,
                    event_type="count",
                    value=str(int(quantity * progress)),
                    order_id=order.id,
                    happened_at=ctx.now - timedelta(minutes=1),
                )
            )
            session.add(
                MachineEvent(machine_id=machine.id, event_type="status", value="running", happened_at=start)
            )
            machine.status = "running"

    # material already issued to the floor (topped up first, so stock never goes negative)
    for material_id, needed in (await material.order_requirements(session, order.id)).items():
        on_hand = await _stock(session, material_id)
        if on_hand < needed * 2:
            session.add(
                StockMovement(
                    material_id=material_id,
                    quantity=(needed * 2 - on_hand).quantize(Decimal("1")) + 1,
                    movement_type="receive",
                    reference=f"Supplier delivery for {order.order_number}",
                    user_id=ctx.users["store"].id,
                )
            )
        session.add(
            StockMovement(
                material_id=material_id,
                quantity=-needed,
                movement_type="issue",
                reference=order.order_number,
                order_id=order.id,
                user_id=ctx.users["store"].id,
            )
        )

    for state in ("EXTRACTED", "VERIFIED", "MATERIAL_CHECKED", "PLANNED", "WAITING_APPROVAL", "RECHECKING"):
        await workflow.transition(session, order, run, state)
    approval = Approval(order_id=order.id, approver_id=ctx.users["manager"].id)
    session.add(approval)
    await session.flush()
    await _decide(ctx, approval, "approve", option=option)
    approval.created_at = order.created_at + timedelta(hours=1)
    approval.decided_at = order.created_at + timedelta(hours=2)
    workflow.update(run, selected_option=option.id, approval_type="order", recheck_changes=[])
    for state in ("CONFIRMED", "REPLY_DRAFTED", "CUSTOMER_REPLIED", "IN_PRODUCTION"):
        await workflow.transition(session, order, run, state)
    order.promised_date = order.due_date
    await quality.create_plan(session, order.id)
    await session.flush()
    return order


def _first_machine_code(ctx: Context, machine_type: str) -> str:
    return next(
        code
        for code, machine in sorted(ctx.machines.items())
        if machine.machine_type == machine_type and code != "MILL-02"
    )


async def _qc_results(ctx: Context, order: Order, passed: int, failed: int = 0) -> None:
    plan = await quality.get_plan(ctx.session, order.id)
    inspector = ctx.users["qc"].id
    for check in plan.checks[:passed]:
        ctx.session.add(
            QcRecord(
                order_id=order.id,
                qc_plan_id=plan.id,
                check_name=check["name"],
                result="pass",
                measured_value="Within tolerance",
                inspector_id=inspector,
            )
        )
    for check in plan.checks[passed : passed + failed]:
        ctx.session.add(
            QcRecord(
                order_id=order.id,
                qc_plan_id=plan.id,
                check_name=check["name"],
                result="fail",
                measured_value="Diameter +0.08 mm (limit +0.05)",
                inspector_id=inspector,
                note="Tool wear on lathe. 12 pieces scrapped, tool changed.",
            )
        )


# ---------------------------------------------------------------- materials
async def _stock(session, material_id) -> Decimal:
    total = await session.scalar(
        select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
            StockMovement.material_id == material_id
        )
    )
    return Decimal(total)


async def _set_stock(ctx: Context, material_row: Material, target: Decimal, reason: str) -> None:
    current = await _stock(ctx.session, material_row.id)
    ctx.session.add(
        StockMovement(
            material_id=material_row.id,
            quantity=target - current,
            movement_type="adjust",
            reference="Stock count",
            reason=reason,
            user_id=ctx.users["store"].id,
        )
    )


async def _main_material(session, part: Part) -> Material:
    line = await session.scalar(
        select(BomLine).where(BomLine.part_id == part.id).order_by(BomLine.quantity_per_part.desc()).limit(1)
    )
    return await session.get(Material, line.material_id)


# ---------------------------------------------------------------- main
async def add_scenarios() -> dict[str, str]:
    """Adds the test scenarios. Needs the demo seed first. Returns {scenario: order number}."""
    created: dict[str, str] = {}
    async with session_scope() as session:
        if await session.scalar(select(func.count()).select_from(Part)) == 0:
            raise RuntimeError("Run the demo seed first: python -m app.simulator seed --reset")
        if await session.scalar(select(Order.id).where(Order.order_number.like("%-T001")).limit(1)):
            raise RuntimeError(
                "Test scenarios already exist. Use seed --reset --scenarios to start again."
            )
        ctx = Context(
            session=session,
            now=datetime.now(UTC),
            zone=ZoneInfo(settings.app_timezone),
            machines={machine.code: machine for machine in await session.scalars(select(Machine))},
            users={
                user.email.split("@")[0]: user
                for user in await session.scalars(select(User).where(User.email.like("%@factory.local")))
            },
        )
        picker = PartPicker(await _parts_by_kind(session))
        await _machines(ctx)
        created |= await _running(ctx, picker)
        await session.flush()
        created |= await _approvals(ctx, picker)
        created |= await _early_states(ctx, picker)
        await _materials_and_quotes(ctx, picker)
    logger.info("Test scenarios added: %s", created)
    return created


async def _machines(ctx: Context) -> None:
    session = ctx.session
    # MILL-02 broke down 2 hours ago; repair expected in 6 hours
    mill = ctx.machines["MILL-02"]
    mill.status = "down"
    broke_at = ctx.now - timedelta(hours=2)
    session.add(MachineEvent(machine_id=mill.id, event_type="status", value="down", happened_at=broke_at))
    session.add(
        MaintenanceEvent(
            machine_id=mill.id,
            maintenance_type="breakdown",
            start_at=broke_at,
            end_at=ctx.now + timedelta(hours=6),
            note="Spindle overheating alarm. Technician waiting for a bearing.",
        )
    )
    # past breakdown on LATHE-02, last week, repaired
    lathe = ctx.machines["LATHE-02"]
    past = ctx.now - timedelta(days=6, hours=3)
    session.add(
        MaintenanceEvent(
            machine_id=lathe.id,
            maintenance_type="breakdown",
            start_at=past,
            end_at=past + timedelta(hours=5),
            note="Coolant pump failed. Replaced.",
            downtime_hours=Decimal("5.00"),
        )
    )
    # planned maintenance on the press brake, 3 working days from now, 08:00-13:00 local
    brake = ctx.machines["BRAKE-01"]
    day = ctx.working_day(3)
    session.add(
        MaintenanceEvent(
            machine_id=brake.id,
            maintenance_type="planned",
            start_at=ctx.local_datetime(day, 8),
            end_at=ctx.local_datetime(day, 13),
            note="Planned hydraulic service.",
        )
    )


async def _running(ctx: Context, picker: PartPicker) -> dict[str, str]:
    session = ctx.session
    created = {}
    # 1. Lathe 1 busy for the next ~3.5 days
    order = await _running_order(
        ctx,
        await picker.take(session, "lathe", with_quote=False),
        1500,
        current_step=0,
        machine_codes={"cnc_lathe": "LATHE-01"},
        started_hours_ago=5,
        hours_left=84,
        created_days_ago=6,
        due_in_working_days=8,
    )
    created["running_lathe_1_busy"] = order.order_number
    # 2. Lathe 2 busy for ~2.5 days, with a QC fail and scrap
    order = await _running_order(
        ctx,
        await picker.take(session, "lathe", with_quote=False),
        1200,
        current_step=0,
        machine_codes={"cnc_lathe": "LATHE-02"},
        started_hours_ago=8,
        hours_left=60,
        created_days_ago=5,
        due_in_working_days=6,
    )
    await _qc_results(ctx, order, passed=1, failed=1)
    part_line = await session.scalar(select(OrderLine).where(OrderLine.order_id == order.id))
    scrap_material = await _main_material(session, await session.get(Part, part_line.part_id))
    session.add(
        StockMovement(
            material_id=scrap_material.id,
            quantity=-Decimal("0.6"),
            movement_type="scrap",
            reference=order.order_number,
            reason="12 pieces out of tolerance (tool wear)",
            order_id=order.id,
            user_id=ctx.users["qc"].id,
        )
    )
    created["running_lathe_2_qc_fail"] = order.order_number
    # 3. Sheet metal: laser done, press brake running now
    order = await _running_order(
        ctx,
        await picker.take(session, "sheet", with_quote=False),
        800,
        current_step=1,
        machine_codes={"laser_cutter": "LASER-01", "press_brake": "BRAKE-01"},
        started_hours_ago=2,
        hours_left=20,
        created_days_ago=4,
        due_in_working_days=4,
    )
    created["running_sheet_on_press_brake"] = order.order_number
    # 4. Almost done: machining finished, on the QC station now, QC passing so far
    part = await picker.take(session, "mill", with_quote=False)
    types = await _routing_types(session, part.id)
    order = await _running_order(
        ctx,
        part,
        300,
        current_step=types.index("qc_station"),
        machine_codes={"cnc_lathe": "LATHE-02", "cnc_mill": "MILL-01"},
        started_hours_ago=1,
        hours_left=3,
        created_days_ago=9,
        due_in_working_days=2,
    )
    plan = await quality.get_plan(session, order.id)
    await _qc_results(ctx, order, passed=max(1, len(plan.checks) - 1))
    created["running_almost_done_qc_passing"] = order.order_number
    # 5. The laser is also booked for a long job, so new sheet-metal orders must queue
    order = await _running_order(
        ctx,
        await picker.take(session, "sheet", with_quote=False),
        2500,
        current_step=0,
        machine_codes={"laser_cutter": "LASER-01", "press_brake": "BRAKE-01"},
        started_hours_ago=0.5,
        hours_left=40,
        created_days_ago=2,
        due_in_working_days=7,
    )
    created["running_laser_long_job"] = order.order_number
    return created


async def _approvals(ctx: Context, picker: PartPicker) -> dict[str, str]:
    session = ctx.session
    created = {}

    async def quoted(kind: str) -> tuple[Part, Quotation | None]:
        part = await picker.take(session, kind, with_quote=True)
        return part, await _open_quote(session, part)

    # Waiting approval, easy: matches the quotation, plenty of time (the quoted job with the least work)
    part = await picker.take_lightest_quoted(session)
    quote = await _open_quote(session, part)
    order, run = await _receive(
        ctx,
        part,
        int(quote.quantity) if quote else 300,
        quote.quoted_due_date if quote else ctx.working_day(20),
    )
    await _wait_for_approval(ctx, order, run)
    created["waiting_approval_easy"] = order.order_number

    # Waiting approval, tight date on the busy lathes -> delay / overtime / split options; waiting 9 hours
    part = await picker.take(session, "lathe", with_quote=False)
    order, run = await _receive(
        ctx, part, 2000, ctx.working_day(3), unit_price=Decimal("18.00"), created_hours_ago=10
    )
    await _wait_for_approval(ctx, order, run, waiting_hours=9)
    created["waiting_approval_tight_date_9h_old"] = order.order_number

    # Waiting approval, material short -> later ready date and a purchase request after approval
    part = await picker.take(session, "mill", with_quote=False)
    short = await _main_material(session, part)
    await _set_stock(ctx, short, Decimal("2"), "Cycle count found less stock than recorded")
    order, run = await _receive(ctx, part, 600, ctx.working_day(12), unit_price=Decimal("26.00"))
    await _wait_for_approval(ctx, order, run)
    created["waiting_approval_material_short"] = order.order_number

    # Approved, customer reply drafted (sales has not sent it yet)
    part, quote = await quoted("lathe")
    order, run = await _receive(
        ctx,
        part,
        int(quote.quantity) if quote else 400,
        quote.quoted_due_date if quote else ctx.working_day(15),
        created_hours_ago=26,
    )
    await _approve_and_reply(ctx, order, run)
    created["approved_reply_drafted"] = order.order_number

    # Approved and reply sent: customer replied, waiting for production to start
    part, quote = await quoted("sheet")
    order, run = await _receive(
        ctx,
        part,
        int(quote.quantity) if quote else 500,
        quote.quoted_due_date if quote else ctx.working_day(15),
        created_hours_ago=50,
    )
    await _approve_and_reply(ctx, order, run)
    message = await session.scalar(select(CustomerMessage).where(CustomerMessage.order_id == order.id))
    message.status, message.sent_by, message.sent_at = "sent_by_sales", ctx.users["sales"].id, ctx.now
    await workflow.transition(session, order, run, "CUSTOMER_REPLIED")
    created["approved_customer_replied"] = order.order_number

    # Declined by the manager: holds and tentative slots released, decline reply drafted
    part = await picker.take(session, "mill", with_quote=False)
    order, run = await _receive(
        ctx, part, 5000, ctx.working_day(2), unit_price=Decimal("3.00"), created_hours_ago=30
    )
    approval = await _wait_for_approval(ctx, order, run, waiting_hours=20)
    await _decide(
        ctx,
        approval,
        "reject",
        reject_reason="decline",
        comment="Price is far below cost and the date is impossible.",
    )
    await material.release_holds(session, order.id)
    await planning.release_plan(session, order.id)
    await workflow.transition(session, order, run, "DECLINED")
    await draft_customer_reply(session, order.id, None)
    created["declined"] = order.order_number

    # Sent back for a replan: the orchestrator picks it up and plans it again, then asks for approval again
    part = await picker.take(session, "sheet", with_quote=False)
    order, run = await _receive(
        ctx, part, 1200, ctx.working_day(5), unit_price=Decimal("9.50"), created_hours_ago=6
    )
    approval = await _wait_for_approval(ctx, order, run, waiting_hours=4)
    comment = "Do not use overtime this week. Try a split delivery instead."
    await _decide(ctx, approval, "reject", reject_reason="replan", comment=comment)
    workflow.update(run, changes=[comment])
    await material.release_holds(session, order.id)
    await planning.release_plan(session, order.id)
    await workflow.check_material(session, order, run, "REPLAN_NEEDED")
    created["sent_back_for_replan"] = order.order_number
    return created


async def _early_states(ctx: Context, picker: PartPicker) -> dict[str, str]:
    session = ctx.session
    created = {}
    # Needs a field check: wrong revision, price below the quotation, unclear due date
    part = await picker.take(session, "lathe", with_quote=True)
    quote = await _open_quote(session, part)
    wrong_revision = chr(ord(part.revision[0]) + 1)
    order, run = await _receive(
        ctx,
        part,
        int(quote.quantity) if quote else 500,
        quote.quoted_due_date if quote else ctx.working_day(10),
        unit_price=(quote.unit_price * Decimal("0.9")).quantize(Decimal("0.01")) if quote else Decimal("10"),
        revision=wrong_revision,
        layout="faxed",
        low_confidence=("due_date",),
    )
    await workflow.transition(session, order, run, "EXTRACTED")
    await workflow.transition(session, order, run, "NEEDS_FIELD_CHECK")
    created["needs_field_check"] = order.order_number

    # Failed: extraction could not run
    part = await picker.take(session, "sheet", with_quote=None)
    order, run = await _receive(ctx, part, 250, ctx.working_day(10), created_hours_ago=3)
    await workflow.fail(
        session, order, run, "AI provider not reachable: connection timed out (seeded test failure)"
    )
    created["failed"] = order.order_number
    return created


async def _materials_and_quotes(ctx: Context, picker: PartPicker) -> None:
    session = ctx.session
    # a second material below its minimum, already ordered from the supplier
    fastener = await session.scalar(select(Material).where(Material.code == "M8-PEM-NUT"))
    await _set_stock(ctx, fastener, Decimal("30"), "Damaged box found during stock count")
    supplier = await session.scalar(select(Supplier).order_by(Supplier.name).limit(1))
    session.add(
        PurchaseRequest(
            material_id=fastener.id,
            supplier_id=supplier.id,
            quantity=Decimal("2000"),
            needed_by=ctx.working_day(4),
            status="sent",
        )
    )
    # one quotation expired (date passed)
    quote = await session.scalar(
        select(Quotation).where(Quotation.status == "open").order_by(Quotation.quote_number.desc()).limit(1)
    )
    if quote:
        quote.status = "expired"
        quote.quoted_due_date = ctx.now.date() - timedelta(days=10)
