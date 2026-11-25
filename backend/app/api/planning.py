"""Schedule queries and read-only what-if calculations."""

from datetime import UTC, date, datetime, time
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.planning.service import what_if
from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user
from app.models import MaintenanceEvent, Order, ScheduleSlot, User
from app.schemas.api import MaintenanceWindowOut, ScheduleOut, ScheduleSlotOut, WhatIfRequest, WhatIfResult

router = APIRouter(tags=["planning"])


def parse_boundary(value: str) -> datetime:
    try:
        zone = ZoneInfo(settings.app_timezone)
        timestamp = (
            datetime.combine(date.fromisoformat(value), time.min, tzinfo=zone)
            if len(value) == 10
            else (datetime.fromisoformat(value))
        )
    except ValueError as error:
        raise HTTPException(422, "Schedule boundaries must be ISO dates or timestamps") from error
    return (timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=zone)).astimezone(UTC)


@router.get("/schedule", response_model=ScheduleOut)
async def get_schedule(
    from_value: Annotated[str, Query(alias="from")],
    to_value: Annotated[str, Query(alias="to")],
    machine_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    start, end = parse_boundary(from_value), parse_boundary(to_value)
    if end <= start:
        raise HTTPException(422, "The schedule end must be after the start")
    slots = (
        select(ScheduleSlot, Order.order_number)
        .join(Order, Order.id == ScheduleSlot.order_id)
        .where(ScheduleSlot.start_at < end, ScheduleSlot.end_at > start)
        .order_by(ScheduleSlot.start_at, ScheduleSlot.id)
    )
    maintenance = (
        select(MaintenanceEvent)
        .where(
            MaintenanceEvent.start_at < end,
            or_(MaintenanceEvent.end_at.is_(None), MaintenanceEvent.end_at > start),
        )
        .order_by(MaintenanceEvent.start_at, MaintenanceEvent.id)
    )
    if machine_id is not None:
        slots = slots.where(ScheduleSlot.machine_id == machine_id)
        maintenance = maintenance.where(MaintenanceEvent.machine_id == machine_id)
    return ScheduleOut(
        slots=[
            ScheduleSlotOut(
                id=slot.id,
                order_id=slot.order_id,
                order_number=number,
                machine_id=slot.machine_id,
                routing_step=slot.routing_step,
                quantity=slot.quantity,
                start_at=slot.start_at,
                end_at=slot.end_at,
                status=slot.status,
                is_overtime=slot.is_overtime,
            )
            for slot, number in await session.execute(slots)
        ],
        maintenance=[MaintenanceWindowOut.model_validate(row) for row in await session.scalars(maintenance)],
    )


@router.post("/plan/what-if", response_model=WhatIfResult)
async def plan_what_if(
    body: WhatIfRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    try:
        return await what_if(session, body)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
