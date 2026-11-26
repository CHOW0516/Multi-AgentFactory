"""Compute inventory from the ledger and serialize reservations per material."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_CEILING, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.settings import effective_settings
from app.core.audit import write_audit
from app.core.config import settings
from app.models import (
    CLOSED_ORDER_STATES,
    AuditLog,
    BomLine,
    Material,
    Order,
    OrderLine,
    PurchaseRequest,
    StockHold,
    StockMovement,
    SupplierItem,
)
from app.schemas.api import MaterialNeed, MaterialStatusOut
from app.schemas.contracts import CheckAndHoldResult, CreatePurchaseRequestsResult, RecheckResult, Shortage

ZERO = Decimal(0)
UNKNOWN_READY_DATE = date.max


def active_holds(now: datetime):
    return or_(StockHold.hold_type == "firm", StockHold.expires_at > now)


async def load_materials(session: AsyncSession, ids, *, lock: bool = False) -> list[Material]:
    query = select(Material).where(Material.id.in_(ids)).order_by(Material.id)
    if lock:
        query = query.with_for_update()
    return list(await session.scalars(query))


async def balances(session: AsyncSession, ids, now: datetime, order_id: UUID | None = None):
    stock = dict(
        (
            await session.execute(
                select(StockMovement.material_id, func.sum(StockMovement.quantity))
                .where(StockMovement.material_id.in_(ids))
                .group_by(StockMovement.material_id)
            )
        ).all()
    )
    held_query = select(StockHold.material_id, func.sum(StockHold.quantity)).where(
        StockHold.material_id.in_(ids), active_holds(now)
    )
    if order_id is not None:
        held_query = held_query.where(or_(StockHold.order_id != order_id, StockHold.hold_type == "firm"))
    held = dict((await session.execute(held_query.group_by(StockHold.material_id))).all())
    return stock, held


def stock_warnings(material: Material, stock: Decimal, now: datetime, warning_days: float) -> list[str]:
    messages = []
    if stock < 0:
        messages.append(f"{material.code}: stock is negative ({stock}).")
    if material.last_counted_at is None:
        messages.append(f"{material.code}: no stock count is recorded.")
    elif material.last_counted_at < now - timedelta(days=warning_days):
        messages.append(f"{material.code}: last stock count is older than {warning_days:g} days.")
    return messages


async def requirements(session: AsyncSession, items: list[tuple[UUID, Decimal]]) -> dict[UUID, Decimal]:
    quantities: dict[UUID, Decimal] = defaultdict(Decimal)
    for part_id, quantity in items:
        quantities[part_id] += quantity
    rows = await session.scalars(select(BomLine).where(BomLine.part_id.in_(quantities)))
    needed: dict[UUID, Decimal] = defaultdict(Decimal)
    for row in rows:
        needed[row.material_id] += quantities[row.part_id] * row.quantity_per_part * (1 + row.scrap_rate)
    return {
        material_id: quantity.quantize(Decimal("0.001"), rounding=ROUND_CEILING)
        for material_id, quantity in needed.items()
        if quantity > 0
    }


async def order_requirements(session: AsyncSession, order_id: UUID) -> dict[UUID, Decimal]:
    rows = await session.scalars(select(OrderLine).where(OrderLine.order_id == order_id))
    items = []
    for row in rows:
        if row.part_id is None or row.quantity <= 0:
            raise ValueError(f"Order line {row.line_number} needs a verified part and quantity")
        items.append((row.part_id, row.quantity))
    if not items:
        raise ValueError("Order has no lines to reserve")
    return await requirements(session, items)


async def order_holds(session: AsyncSession, order_id: UUID) -> list[StockHold]:
    return list(
        await session.scalars(
            select(StockHold)
            .where(StockHold.order_id == order_id)
            .order_by(StockHold.material_id, StockHold.id)
            .execution_options(populate_existing=True)
        )
    )


async def lock_order(session: AsyncSession, order_id: UUID, *, open_only: bool = False) -> Order:
    order = await session.get(Order, order_id, with_for_update=True, populate_existing=True)
    if order is None:
        raise ValueError("Order not found")
    if open_only and order.status in CLOSED_ORDER_STATES:
        # A late task must not reserve stock for an order that was cancelled or closed meanwhile.
        raise ValueError(f"Order is {order.status}; no stock is reserved for it")
    return order


@dataclass
class Forecast:
    needs: list[MaterialNeed]
    warnings: list[str]
    suppliers: dict[UUID, SupplierItem]
    today: date

    @property
    def ready_date(self) -> date:
        arrivals = [need.arrives for need in self.needs if need.short > 0]
        if any(arrival is None for arrival in arrivals):
            return UNKNOWN_READY_DATE
        return max((arrival for arrival in arrivals if arrival is not None), default=self.today)

    @property
    def shortages(self) -> list[Shortage]:
        return [
            Shortage(material_id=need.material_id, short_qty=need.short, arrives=need.arrives)
            for need in self.needs
            if need.short > 0
        ]


async def forecast(
    session: AsyncSession,
    needed: dict[UUID, Decimal],
    *,
    order_id: UUID | None = None,
    now: datetime | None = None,
) -> Forecast:
    now = now or datetime.now(UTC)
    today = now.astimezone(ZoneInfo(settings.app_timezone)).date()
    config = await effective_settings(session)
    materials = await load_materials(session, needed)
    stock, held = await balances(session, needed, now, order_id)
    own_holds = await order_holds(session, order_id) if order_id else []
    own: dict[UUID, Decimal] = defaultdict(Decimal)
    firm: dict[UUID, Decimal] = defaultdict(Decimal)
    for hold in own_holds:
        if hold.hold_type == "firm":
            firm[hold.material_id] += hold.quantity
            own[hold.material_id] += hold.quantity
        elif hold.expires_at is not None and hold.expires_at > now:
            own[hold.material_id] += hold.quantity

    rows = await session.scalars(
        select(SupplierItem)
        .where(SupplierItem.material_id.in_(needed), SupplierItem.lead_time_days >= 0)
        .order_by(SupplierItem.lead_time_days, SupplierItem.supplier_id)
    )
    suppliers: dict[UUID, SupplierItem] = {}
    for row in rows:
        suppliers.setdefault(row.material_id, row)

    needs, warnings = [], []
    for material in sorted(materials, key=lambda row: row.code):
        material_id = material.id
        stock_qty = stock.get(material_id, ZERO)
        available = stock_qty - held.get(material_id, ZERO)
        usable = max(available + firm[material_id], ZERO)
        short = max(needed[material_id] - usable, ZERO)
        supplier = suppliers.get(material_id)
        arrives = today + timedelta(days=supplier.lead_time_days) if short and supplier else None
        warnings.extend(stock_warnings(material, stock_qty, now, config["stock_count_warning_days"]))
        if short and supplier is None:
            warnings.append(f"{material.code}: there is no supplier lead time for this shortage.")
        needs.append(
            MaterialNeed(
                material_id=material_id,
                material_code=material.code,
                material_name=material.name,
                unit=material.unit,
                needed=needed[material_id],
                available=available,
                held=own[material_id],
                short=short,
                arrives=arrives,
                last_counted_at=material.last_counted_at,
            )
        )
    return Forecast(needs, warnings, suppliers, today)


async def check_and_hold(
    session: AsyncSession, order_id: UUID, task_id: UUID | None = None
) -> CheckAndHoldResult:
    await lock_order(session, order_id, open_only=True)
    if task_id is not None:
        previous = await session.scalar(
            select(AuditLog)
            .where(
                AuditLog.agent == "material",
                AuditLog.action == "check_and_hold",
                AuditLog.entity_id == str(order_id),
                AuditLog.after["task_id"].as_string() == str(task_id),
            )
            .limit(1)
        )
        if previous is not None:
            return CheckAndHoldResult.model_validate(previous.after["result"])

    needed = await order_requirements(session, order_id)
    existing = await order_holds(session, order_id)
    await load_materials(session, set(needed) | {hold.material_id for hold in existing}, lock=True)
    existing = await order_holds(session, order_id)
    now = datetime.now(UTC)
    current = await forecast(session, needed, order_id=order_id, now=now)
    config = await effective_settings(session)
    expiration = now + timedelta(hours=config["hold_expiry_hours"])
    firm: dict[UUID, Decimal] = defaultdict(Decimal)
    temporary: dict[UUID, StockHold] = {}
    for hold in existing:
        if hold.hold_type == "firm":
            firm[hold.material_id] += hold.quantity
        else:
            if hold.material_id in temporary:
                await session.delete(hold)
            else:
                temporary[hold.material_id] = hold

    holds = [hold for hold in existing if hold.hold_type == "firm"]
    for need in current.needs:
        reserved = max(need.needed - need.short - firm.get(need.material_id, ZERO), ZERO)
        hold = temporary.pop(need.material_id, None)
        if reserved:
            if hold is None:
                hold = StockHold(material_id=need.material_id, order_id=order_id, hold_type="temporary")
                session.add(hold)
            hold.quantity, hold.expires_at = reserved, expiration
            holds.append(hold)
        elif hold is not None:
            await session.delete(hold)
    for hold in temporary.values():
        await session.delete(hold)

    await session.flush()
    result = CheckAndHoldResult(
        material_ready_date=current.ready_date if current.ready_date != UNKNOWN_READY_DATE else None,
        shortages=current.shortages,
        hold_ids=[hold.id for hold in holds],
        hold_expires_at=expiration if any(hold.hold_type == "temporary" for hold in holds) else None,
        data_warnings=current.warnings,
    )
    await write_audit(
        session,
        "material",
        "check_and_hold",
        "orders",
        order_id,
        None,
        {
            "task_id": str(task_id) if task_id else None,
            "result": result.model_dump(mode="json"),
        },
    )
    return result


async def latest_check(session: AsyncSession, order_id: UUID) -> CheckAndHoldResult | None:
    entry = await session.scalar(
        select(AuditLog)
        .where(
            AuditLog.agent == "material",
            AuditLog.action == "check_and_hold",
            AuditLog.entity_id == str(order_id),
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(1)
    )
    return CheckAndHoldResult.model_validate(entry.after["result"]) if entry else None


async def recheck_holds(session: AsyncSession, order_id: UUID) -> RecheckResult:
    now = datetime.now(UTC)
    previous = await latest_check(session, order_id)
    current = await forecast(session, await order_requirements(session, order_id), order_id=order_id, now=now)
    holds = await order_holds(session, order_id)
    active = {
        hold.id for hold in holds if hold.hold_type == "firm" or hold.expires_at and hold.expires_at > now
    }
    changes = []
    if previous is None:
        changes.append("No previous material check is recorded.")
    else:
        if set(previous.hold_ids) - active:
            changes.append("One or more material holds expired or were released.")
        original = {item.material_id: item for item in previous.shortages}
        for shortage in current.shortages:
            was = original.get(shortage.material_id)
            if (
                was is None
                or shortage.short_qty > was.short_qty
                or (was.arrives is not None and (shortage.arrives is None or shortage.arrives > was.arrives))
            ):
                changes.append(f"Material {shortage.material_id} has less stock or a later arrival.")
    result = RecheckResult(valid=not changes, changes=changes)
    await write_audit(
        session, "material", "recheck_holds", "orders", order_id, None, result.model_dump(mode="json")
    )
    return result


async def confirm_holds(session: AsyncSession, order_id: UUID) -> None:
    await lock_order(session, order_id, open_only=True)
    holds = await order_holds(session, order_id)
    needed = await order_requirements(session, order_id)
    await load_materials(session, set(needed) | {hold.material_id for hold in holds}, lock=True)
    holds = await order_holds(session, order_id)
    check = await recheck_holds(session, order_id)
    if not check.valid:
        raise ValueError("; ".join(check.changes))
    for hold in holds:
        if hold.hold_type == "temporary":
            hold.hold_type, hold.expires_at = "firm", None
            await write_audit(
                session,
                "material",
                "confirm_hold",
                "stock_holds",
                hold.id,
                {"hold_type": "temporary"},
                {"hold_type": "firm"},
            )


async def release_holds(session: AsyncSession, order_id: UUID) -> None:
    await lock_order(session, order_id)
    existing = await order_holds(session, order_id)
    await load_materials(session, {hold.material_id for hold in existing}, lock=True)
    for hold in await order_holds(session, order_id):
        await session.delete(hold)
        await write_audit(
            session,
            "material",
            "release_hold",
            "stock_holds",
            hold.id,
            {"order_id": str(order_id), "quantity": str(hold.quantity)},
            None,
        )


async def expire_holds(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    expired = (StockHold.hold_type == "temporary", StockHold.expires_at <= now)
    material_ids = list(await session.scalars(select(StockHold.material_id).where(*expired).distinct()))
    await load_materials(session, material_ids, lock=True)
    holds = list(
        await session.scalars(select(StockHold).where(*expired, StockHold.material_id.in_(material_ids)))
    )
    for hold in holds:
        await session.delete(hold)
        await write_audit(
            session,
            "material",
            "expire_hold",
            "stock_holds",
            hold.id,
            {"order_id": str(hold.order_id), "quantity": str(hold.quantity)},
            None,
        )
    return len(holds)


async def create_purchase_requests(session: AsyncSession, order_id: UUID) -> CreatePurchaseRequestsResult:
    order = await lock_order(session, order_id, open_only=True)
    report = await forecast(session, await order_requirements(session, order_id), order_id=order_id)
    existing = {
        row.material_id: row
        for row in await session.scalars(
            select(PurchaseRequest)
            .where(PurchaseRequest.order_id == order_id, PurchaseRequest.status != "cancelled")
            .order_by(PurchaseRequest.created_at, PurchaseRequest.id)
        )
    }
    for shortage in report.shortages:
        if shortage.material_id not in existing:
            supplier = report.suppliers.get(shortage.material_id)
            row = PurchaseRequest(
                order_id=order_id,
                material_id=shortage.material_id,
                supplier_id=supplier.supplier_id if supplier else None,
                quantity=shortage.short_qty,
                needed_by=order.due_date,
                status="draft",
            )
            session.add(row)
            await session.flush()
            await write_audit(
                session,
                "material",
                "create",
                "purchase_requests",
                row.id,
                None,
                {"order_id": str(order_id), "quantity": str(row.quantity)},
            )
            existing[shortage.material_id] = row
    return CreatePurchaseRequestsResult(purchase_request_ids=[row.id for row in existing.values()])


async def material_status(session: AsyncSession, order_id: UUID) -> MaterialStatusOut:
    now = datetime.now(UTC)
    holds = await order_holds(session, order_id)
    expires = [
        hold.expires_at
        for hold in holds
        if hold.hold_type == "temporary" and hold.expires_at is not None and hold.expires_at > now
    ]
    report = await forecast(session, await order_requirements(session, order_id), order_id=order_id, now=now)
    return MaterialStatusOut(
        material_ready_date=report.ready_date if report.ready_date != UNKNOWN_READY_DATE else None,
        hold_expires_at=min(expires, default=None),
        needs=report.needs,
        data_warnings=report.warnings,
    )
