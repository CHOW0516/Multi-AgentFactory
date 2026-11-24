"""Master data CRUD: users, customers, parts (with BOM and routing), suppliers, machines, shifts, holidays.

Everyone logged in can read. Users are edited by admin; other master data by admin or planner.
"""

import uuid
from datetime import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.db import get_session
from app.core.security import current_user, hash_password, require_roles
from app.models import BomLine, Customer, Holiday, Machine, Part, Routing, Shift, Supplier, User
from app.models.base import TableBase
from app.schemas.api import (
    BomLineIn,
    BomLineOut,
    CustomerIn,
    CustomerOut,
    HolidayIn,
    HolidayOut,
    MachineIn,
    MachineOut,
    MachinePatch,
    PartIn,
    PartOut,
    RoutingStepIn,
    RoutingStepOut,
    ShiftIn,
    ShiftOut,
    SupplierIn,
    SupplierOut,
    UserCreate,
    UserOut,
    UserUpdate,
)

router = APIRouter(tags=["master data"])
edit_master_data = require_roles("planner")  # admin is always allowed


def snapshot(row: TableBase) -> dict[str, Any]:
    return {column.key: str(getattr(row, column.key)) for column in row.__table__.columns}


async def get_or_404[RowT: TableBase](session: AsyncSession, model: type[RowT], row_id: uuid.UUID) -> RowT:
    row = await session.get(model, row_id)
    if row is None:
        raise HTTPException(404, f"{model.__name__} not found")
    return row


async def flush_or_conflict(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(409, "This would create a duplicate or break a link to other data") from error


async def commit_or_conflict(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(409, "This would create a duplicate or break a link to other data") from error


async def create_row(session: AsyncSession, user: User, model: type[TableBase], values: dict) -> TableBase:
    row = model(**values)
    session.add(row)
    await flush_or_conflict(session)
    await write_audit(session, user, "create", model.__tablename__, row.id, None, snapshot(row))
    await commit_or_conflict(session)
    return row


async def update_row(session: AsyncSession, user: User, row: TableBase, values: dict) -> TableBase:
    before = snapshot(row)
    for key, value in values.items():
        setattr(row, key, value)
    await flush_or_conflict(session)
    await write_audit(session, user, "update", row.__tablename__, row.id, before, snapshot(row))
    await commit_or_conflict(session)
    await session.refresh(row)
    return row


def changed_values(body: BaseModel) -> dict:
    return body.model_dump(exclude_unset=True)


# ---- users ----
@router.get("/users", response_model=list[UserOut])
async def list_users(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    return (await session.scalars(select(User).order_by(User.name))).all()


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate, session: AsyncSession = Depends(get_session), user: User = Depends(require_roles())
):
    values = body.model_dump(exclude={"password"}) | {
        "email": body.email.strip().lower(),
        "password_hash": hash_password(body.password),
    }
    return await create_row(session, user, User, values)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_roles()),
):
    target = await get_or_404(session, User, user_id)
    values = changed_values(body)
    if "password" in values:
        values["password_hash"] = hash_password(values.pop("password"))
    if values.get("backup_approver_id") == user_id:
        raise HTTPException(422, "A user cannot be their own backup approver")
    return await update_row(session, user, target, values)


# ---- customers ----
@router.get("/customers", response_model=list[CustomerOut])
async def list_customers(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    return (await session.scalars(select(Customer).order_by(Customer.name))).all()


@router.post("/customers", response_model=CustomerOut, status_code=201)
async def create_customer(
    body: CustomerIn, session: AsyncSession = Depends(get_session), user: User = Depends(edit_master_data)
):
    return await create_row(session, user, Customer, body.model_dump())


@router.patch("/customers/{customer_id}", response_model=CustomerOut)
async def update_customer(
    customer_id: uuid.UUID,
    body: CustomerIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    return await update_row(
        session, user, await get_or_404(session, Customer, customer_id), changed_values(body)
    )


# ---- parts, BOM, routing ----
@router.get("/parts", response_model=list[PartOut])
async def list_parts(
    customer_id: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    query = select(Part).order_by(Part.part_number, Part.revision)
    if customer_id:
        query = query.where(Part.customer_id == customer_id)
    return (await session.scalars(query)).all()


@router.post("/parts", response_model=PartOut, status_code=201)
async def create_part(
    body: PartIn, session: AsyncSession = Depends(get_session), user: User = Depends(edit_master_data)
):
    return await create_row(session, user, Part, body.model_dump())


@router.patch("/parts/{part_id}", response_model=PartOut)
async def update_part(
    part_id: uuid.UUID,
    body: PartIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    return await update_row(session, user, await get_or_404(session, Part, part_id), changed_values(body))


@router.get("/parts/{part_id}/bom", response_model=list[BomLineOut])
async def get_bom(
    part_id: uuid.UUID, session: AsyncSession = Depends(get_session), user: User = Depends(current_user)
):
    await get_or_404(session, Part, part_id)
    return (await session.scalars(select(BomLine).where(BomLine.part_id == part_id))).all()


@router.post("/parts/{part_id}/bom", response_model=list[BomLineOut])
async def replace_bom(
    part_id: uuid.UUID,
    body: list[BomLineIn],
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    """Replaces the whole BOM of a part."""
    await get_or_404(session, Part, part_id)
    old_lines = (await session.scalars(select(BomLine).where(BomLine.part_id == part_id))).all()
    before = [
        {"material_id": str(line.material_id), "quantity_per_part": str(line.quantity_per_part)}
        for line in old_lines
    ]
    await session.execute(delete(BomLine).where(BomLine.part_id == part_id))
    for line in body:
        session.add(BomLine(part_id=part_id, **line.model_dump()))
    await write_audit(
        session,
        user,
        "replace_bom",
        "parts",
        part_id,
        {"lines": before},
        {"lines": [line.model_dump(mode="json") for line in body]},
    )
    await commit_or_conflict(session)
    return (await session.scalars(select(BomLine).where(BomLine.part_id == part_id))).all()


@router.get("/parts/{part_id}/routing", response_model=list[RoutingStepOut])
async def get_routing(
    part_id: uuid.UUID, session: AsyncSession = Depends(get_session), user: User = Depends(current_user)
):
    await get_or_404(session, Part, part_id)
    query = select(Routing).where(Routing.part_id == part_id).order_by(Routing.step_number)
    return (await session.scalars(query)).all()


@router.post("/parts/{part_id}/routing", response_model=list[RoutingStepOut])
async def replace_routing(
    part_id: uuid.UUID,
    body: list[RoutingStepIn],
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    """Replaces the whole routing of a part."""
    await get_or_404(session, Part, part_id)
    step_numbers = [step.step_number for step in body]
    if len(step_numbers) != len(set(step_numbers)):
        raise HTTPException(422, "Step numbers must be unique")
    await session.execute(delete(Routing).where(Routing.part_id == part_id))
    for step in body:
        session.add(Routing(part_id=part_id, **step.model_dump()))
    await write_audit(
        session,
        user,
        "replace_routing",
        "parts",
        part_id,
        None,
        {"steps": [step.model_dump(mode="json") for step in body]},
    )
    await commit_or_conflict(session)
    query = select(Routing).where(Routing.part_id == part_id).order_by(Routing.step_number)
    return (await session.scalars(query)).all()


# ---- suppliers ----
@router.get("/suppliers", response_model=list[SupplierOut])
async def list_suppliers(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    return (await session.scalars(select(Supplier).order_by(Supplier.name))).all()


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
async def create_supplier(
    body: SupplierIn, session: AsyncSession = Depends(get_session), user: User = Depends(edit_master_data)
):
    return await create_row(session, user, Supplier, body.model_dump())


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
async def update_supplier(
    supplier_id: uuid.UUID,
    body: SupplierIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    return await update_row(
        session, user, await get_or_404(session, Supplier, supplier_id), changed_values(body)
    )


# ---- machines ----
@router.get("/machines", response_model=list[MachineOut])
async def list_machines(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    return (await session.scalars(select(Machine).order_by(Machine.code))).all()


@router.post("/machines", response_model=MachineOut, status_code=201)
async def create_machine(
    body: MachineIn, session: AsyncSession = Depends(get_session), user: User = Depends(require_roles())
):
    return await create_row(session, user, Machine, body.model_dump())


@router.patch("/machines/{machine_id}", response_model=MachineOut)
async def update_machine(
    machine_id: uuid.UUID,
    body: MachinePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_roles()),
):
    """Machine status is changed through POST /machines/{id}/status (machine operations), not here."""
    return await update_row(
        session, user, await get_or_404(session, Machine, machine_id), changed_values(body)
    )


# ---- shifts and holidays ----
def parse_clock(value: str) -> time:
    try:
        return time.fromisoformat(value)
    except ValueError as error:
        raise HTTPException(422, f"Time must be HH:MM, got {value!r}") from error


def shift_out(shift: Shift) -> ShiftOut:
    return ShiftOut(
        id=shift.id,
        name=shift.name,
        weekday=shift.weekday,
        start_time=shift.start_time.strftime("%H:%M"),
        end_time=shift.end_time.strftime("%H:%M"),
    )


def shift_values(body: ShiftIn) -> dict:
    if not 0 <= body.weekday <= 6:
        raise HTTPException(422, "weekday must be 0 (Monday) to 6 (Sunday)")
    start, end = parse_clock(body.start_time), parse_clock(body.end_time)
    if start == end:
        raise HTTPException(422, "A shift cannot start and end at the same time")
    return {"name": body.name, "weekday": body.weekday, "start_time": start, "end_time": end}


@router.get("/shifts", response_model=list[ShiftOut])
async def list_shifts(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    rows = (await session.scalars(select(Shift).order_by(Shift.weekday, Shift.start_time))).all()
    return [shift_out(row) for row in rows]


@router.post("/shifts", response_model=ShiftOut, status_code=201)
async def create_shift(
    body: ShiftIn, session: AsyncSession = Depends(get_session), user: User = Depends(edit_master_data)
):
    return shift_out(await create_row(session, user, Shift, shift_values(body)))


@router.patch("/shifts/{shift_id}", response_model=ShiftOut)
async def update_shift(
    shift_id: uuid.UUID,
    body: ShiftIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    row = await get_or_404(session, Shift, shift_id)
    return shift_out(await update_row(session, user, row, shift_values(body)))


@router.get("/holidays", response_model=list[HolidayOut])
async def list_holidays(session: AsyncSession = Depends(get_session), user: User = Depends(current_user)):
    return (await session.scalars(select(Holiday).order_by(Holiday.holiday_date))).all()


@router.post("/holidays", response_model=HolidayOut, status_code=201)
async def create_holiday(
    body: HolidayIn, session: AsyncSession = Depends(get_session), user: User = Depends(edit_master_data)
):
    return await create_row(session, user, Holiday, body.model_dump())


@router.patch("/holidays/{holiday_id}", response_model=HolidayOut)
async def update_holiday(
    holiday_id: uuid.UUID,
    body: HolidayIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(edit_master_data),
):
    return await update_row(
        session, user, await get_or_404(session, Holiday, holiday_id), changed_values(body)
    )
