"""Inventory reads and store-ledger updates."""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.material.service import ZERO, active_holds, balances, load_materials, stock_warnings
from app.api.master_data import get_or_404
from app.api.settings import effective_settings
from app.core.audit import write_audit
from app.core.db import get_session
from app.core.security import current_user
from app.models import Material, Order, PurchaseRequest, StockHold, StockMovement, User
from app.schemas.api import (
    CycleCountIn,
    MaterialOut,
    PurchaseRequestOut,
    StockHoldOut,
    StockMovementIn,
    StockMovementOut,
)

router = APIRouter(tags=["materials"])
QUANTITY_LIMIT = Decimal("100000000000")


async def store_only(user: User = Depends(current_user)) -> User:
    if user.role != "store":
        raise HTTPException(403, "Only store users may update inventory")
    return user


async def material_rows(
    session: AsyncSession,
    materials: list[Material],
    user: User,
) -> list[MaterialOut]:
    now = datetime.now(UTC)
    stock, held = await balances(session, [row.id for row in materials], now)
    config = await effective_settings(session)
    return [
        MaterialOut(
            id=row.id,
            code=row.code,
            name=row.name,
            unit=row.unit,
            min_stock=row.min_stock,
            unit_cost=None if user.role == "store" else row.unit_cost,
            stock=stock.get(row.id, ZERO),
            available=stock.get(row.id, ZERO) - held.get(row.id, ZERO),
            held=held.get(row.id, ZERO),
            last_counted_at=row.last_counted_at,
            warnings=stock_warnings(row, stock.get(row.id, ZERO), now, config["stock_count_warning_days"]),
        )
        for row in materials
    ]


@router.get("/materials", response_model=list[MaterialOut])
async def list_materials(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    return await material_rows(
        session, list(await session.scalars(select(Material).order_by(Material.code))), user
    )


@router.get("/materials/{material_id}", response_model=MaterialOut)
async def get_material(
    material_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    material = await get_or_404(session, Material, material_id)
    return (await material_rows(session, [material], user))[0]


@router.get("/stock-movements", response_model=list[StockMovementOut])
async def movements(
    material_id: UUID | None = None,
    order_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    query = select(StockMovement).order_by(StockMovement.created_at.desc(), StockMovement.id)
    if material_id is not None:
        query = query.where(StockMovement.material_id == material_id)
    if order_id is not None:
        query = query.where(StockMovement.order_id == order_id)
    return list(await session.scalars(query))


def validate_quantity(quantity: Decimal, *, allow_zero: bool = False) -> None:
    if (
        not quantity.is_finite()
        or abs(quantity) >= QUANTITY_LIMIT
        or quantity != quantity.quantize(Decimal("0.001"))
        or (not quantity and not allow_zero)
    ):
        raise HTTPException(422, "Quantity must fit stock precision and have at most three decimal places")


async def lock_material(session: AsyncSession, material_id: UUID) -> Material:
    rows = await load_materials(session, [material_id], lock=True)
    if not rows:
        raise HTTPException(404, "Material not found")
    return rows[0]


async def save_movement(session: AsyncSession, movement: StockMovement, user: User) -> None:
    session.add(movement)
    await session.flush()
    await write_audit(
        session,
        user,
        "create",
        "stock_movements",
        movement.id,
        None,
        {
            "material_id": str(movement.material_id),
            "quantity": str(movement.quantity),
            "movement_type": movement.movement_type,
            "reason": movement.reason,
        },
    )


async def consume_holds(session: AsyncSession, order_id: UUID, material_id: UUID, quantity, user: User):
    """Issued material is no longer reserved: reduce the order's holds by the issued quantity.
    Without this the issue lowers stock and the hold stays, so available stock drops twice."""
    remaining = quantity
    holds = await session.scalars(
        select(StockHold)
        .where(StockHold.order_id == order_id, StockHold.material_id == material_id)
        .order_by((StockHold.hold_type == "firm").desc(), StockHold.created_at, StockHold.id)
    )
    for hold in holds:
        if remaining <= 0:
            break
        used = min(hold.quantity, remaining)
        remaining -= used
        before, left = hold.quantity, hold.quantity - used
        if left == 0:
            await session.delete(hold)
        else:
            hold.quantity = left
        await write_audit(
            session,
            user,
            "consume_hold",
            "stock_holds",
            hold.id,
            {"quantity": str(before)},
            {"quantity": str(left), "order_id": str(order_id)},
        )


@router.post("/stock-movements", response_model=StockMovementOut, status_code=201)
async def add_movement(
    body: StockMovementIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(store_only),
):
    validate_quantity(body.quantity)
    values = body.model_dump()
    kind = body.movement_type
    if body.reason is not None:
        values["reason"] = body.reason.strip() or None
    if kind == "adjust" and not values.get("reason"):
        raise HTTPException(422, "An adjustment requires a reason")
    if kind in {"receive", "return"} and body.quantity < 0:
        raise HTTPException(422, "Incoming movements must have a positive quantity")
    if kind in {"issue", "scrap"}:
        values["quantity"] = -abs(body.quantity)
    if (values["reason"] and len(values["reason"]) > 300) or (body.reference and len(body.reference) > 200):
        raise HTTPException(422, "Movement reason or reference is too long")
    if body.order_id is not None:
        order = await session.get(Order, body.order_id, with_for_update={"read": True, "key_share": True})
        if order is None:
            raise HTTPException(404, "Order not found")
    await lock_material(session, body.material_id)
    row = StockMovement(**values, user_id=user.id)
    await save_movement(session, row, user)
    if kind == "issue" and body.order_id is not None:
        await consume_holds(session, body.order_id, body.material_id, abs(body.quantity), user)
    await session.commit()
    return row


@router.get("/holds", response_model=list[StockHoldOut])
async def list_holds(
    material_id: UUID | None = None,
    order_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    query = (
        select(StockHold)
        .where(active_holds(datetime.now(UTC)))
        .order_by(StockHold.created_at.desc(), StockHold.id)
    )
    if material_id is not None:
        query = query.where(StockHold.material_id == material_id)
    if order_id is not None:
        query = query.where(StockHold.order_id == order_id)
    return list(await session.scalars(query))


@router.get("/purchase-requests", response_model=list[PurchaseRequestOut])
async def purchase_requests(
    material_id: UUID | None = None,
    order_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    query = select(PurchaseRequest).order_by(PurchaseRequest.created_at.desc(), PurchaseRequest.id)
    if material_id is not None:
        query = query.where(PurchaseRequest.material_id == material_id)
    if order_id is not None:
        query = query.where(PurchaseRequest.order_id == order_id)
    return list(await session.scalars(query))


@router.post("/cycle-counts", response_model=StockMovementOut, status_code=201)
async def cycle_count(
    body: CycleCountIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(store_only),
):
    validate_quantity(body.counted_quantity, allow_zero=True)
    if body.counted_quantity < 0 or (body.note and len(body.note) > 300):
        raise HTTPException(422, "Count must be non-negative and notes must fit 300 characters")
    material = await lock_material(session, body.material_id)
    now = datetime.now(UTC)
    stock, _ = await balances(session, [material.id], now)
    prior = stock.get(material.id, ZERO)
    difference = body.counted_quantity - prior
    validate_quantity(difference, allow_zero=True)
    movement = StockMovement(
        material_id=material.id,
        quantity=difference,
        movement_type="adjust",
        reason=body.note or "Cycle count",
        user_id=user.id,
    )
    await save_movement(session, movement, user)
    before = material.last_counted_at
    material.last_counted_at = now
    await write_audit(
        session,
        user,
        "cycle_count",
        "materials",
        material.id,
        {"stock": str(prior), "last_counted_at": before.isoformat() if before else None},
        {"stock": str(body.counted_quantity), "last_counted_at": now.isoformat()},
    )
    await session.commit()
    return movement
