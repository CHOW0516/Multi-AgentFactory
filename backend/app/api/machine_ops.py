import math
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.agents.monitoring import ManualSource, slot_for
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user, require_roles
from app.models import Approval, Machine, MachineEvent, MaintenanceEvent, Order, ScheduleSlot
from app.orchestrator.read_models import schedule_rows
from app.schemas.api import (
    BreakdownIn,
    FloorMachine,
    FloorOut,
    JobRef,
    MachineOutputIn,
    MachineOverview,
    MachineStatusIn,
)
from app.schemas.contracts import MachineRaw

router = APIRouter(tags=["machines"])
operator = require_roles("planner", "manager")


def local_start(now, days_since_start=0):
    local = now.astimezone(ZoneInfo(settings.app_timezone))
    return (
        local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_since_start)
    ).astimezone(UTC)


async def utilisation(session, machine_id, start, end):
    seconds = (end - start).total_seconds()
    if seconds <= 0:
        return 0.0
    filters = (MachineEvent.machine_id == machine_id, MachineEvent.event_type == "status")
    status = await session.scalar(
        select(MachineEvent.value)
        .where(*filters, MachineEvent.happened_at < start)
        .order_by(MachineEvent.happened_at.desc(), MachineEvent.id.desc())
        .limit(1)
    )
    events = await session.scalars(
        select(MachineEvent)
        .where(*filters, MachineEvent.happened_at >= start, MachineEvent.happened_at <= end)
        .order_by(MachineEvent.happened_at, MachineEvent.id)
    )
    cursor, running = start, 0.0
    for event in events:
        if status == "running":
            running += (event.happened_at - cursor).total_seconds()
        cursor, status = event.happened_at, event.value
    if status == "running":
        running += (end - cursor).total_seconds()
    return round(100 * running / seconds, 2)


async def find_machine(session, machine_id):
    machine = await session.get(Machine, machine_id)
    if machine is None:
        raise HTTPException(404, "Machine not found")
    return machine


async def submit(session, user, machine_id, kind, value, now):
    await ManualSource(session).submit(MachineRaw(machine_id=machine_id, kind=kind, value=str(value), at=now))
    await write_audit(session, user, f"submit_machine_{kind}", "machine", machine_id, after={"value": value})
    await session.commit()
    return {"status": "accepted"}


@router.post("/machines/{machine_id}/status", status_code=202)
async def status(
    machine_id: uuid.UUID, body: MachineStatusIn, session=Depends(get_session), user=Depends(operator)
):
    await find_machine(session, machine_id)
    return await submit(session, user, machine_id, "status", body.status, datetime.now(UTC))


@router.post("/machines/{machine_id}/output", status_code=202)
async def output(
    machine_id: uuid.UUID, body: MachineOutputIn, session=Depends(get_session), user=Depends(operator)
):
    await find_machine(session, machine_id)
    now = datetime.now(UTC)
    if not 0 <= body.count <= 10**12:
        raise HTTPException(422, "Count must be between zero and one trillion")
    if body.order_id:
        slot = await slot_for(session, machine_id, now)
        if slot is None or slot.order_id != body.order_id:
            raise HTTPException(409, "That order is not the machine's current job")
    return await submit(session, user, machine_id, "count", body.count, now)


@router.post("/machines/{machine_id}/breakdown", status_code=202)
async def breakdown(
    machine_id: uuid.UUID, body: BreakdownIn, session=Depends(get_session), user=Depends(operator)
):
    await find_machine(session, machine_id)
    hours = body.expected_hours
    if hours is not None and (not math.isfinite(hours) or not 0 < hours < 100000):
        raise HTTPException(422, "Expected hours must be positive and less than 100,000")
    now = datetime.now(UTC)
    event = MaintenanceEvent(
        machine_id=machine_id,
        maintenance_type="breakdown",
        note=body.note,
        start_at=now,
        end_at=now + timedelta(hours=hours) if hours is not None else None,
    )
    session.add(event)
    await session.flush()
    await write_audit(
        session,
        user,
        "log_breakdown",
        "machine",
        machine_id,
        after={"maintenance_event_id": str(event.id), "note": body.note},
    )
    return await submit(session, user, machine_id, "status", "down", now)


@router.get("/machines/{machine_id}/overview", response_model=MachineOverview)
async def overview(machine_id: uuid.UUID, session=Depends(get_session), user=Depends(current_user)):
    machine = await find_machine(session, machine_id)
    now = datetime.now(UTC)
    slots = await schedule_rows(
        session,
        ScheduleSlot.machine_id == machine_id,
        ScheduleSlot.status == "locked",
        ScheduleSlot.end_at > now,
        limit=11,
    )
    current = next((JobRef.model_validate(slot) for slot in slots if slot.start_at <= now), None)
    future = [JobRef.model_validate(slot) for slot in slots if slot.start_at > now]
    events = list(
        await session.scalars(
            select(MachineEvent)
            .where(MachineEvent.machine_id == machine_id)
            .order_by(MachineEvent.happened_at.desc())
            .limit(25)
        )
    )
    maintenance = list(
        await session.scalars(
            select(MaintenanceEvent)
            .where(MaintenanceEvent.machine_id == machine_id)
            .order_by(MaintenanceEvent.start_at.desc())
            .limit(25)
        )
    )
    return MachineOverview(
        machine=machine,
        current_job=current,
        next_jobs=future,
        utilisation_today=await utilisation(session, machine.id, local_start(now), now),
        recent_events=events,
        maintenance_history=maintenance,
    )


@router.get("/floor", response_model=FloorOut)
async def floor(session=Depends(get_session), user=Depends(current_user)):
    now = datetime.now(UTC)
    machines = await session.scalars(select(Machine).order_by(Machine.code))
    rows = []
    for machine in machines:
        slot = await slot_for(session, machine.id, now)
        order_number = None
        count = None
        if slot and (slot.end_at > now or machine.status == "running"):
            order_number = await session.scalar(select(Order.order_number).where(Order.id == slot.order_id))
            count = await session.scalar(
                select(MachineEvent.value)
                .where(
                    MachineEvent.machine_id == machine.id,
                    MachineEvent.order_id == slot.order_id,
                    MachineEvent.event_type == "count",
                    MachineEvent.happened_at >= slot.start_at,
                )
                .order_by(MachineEvent.happened_at.desc())
                .limit(1)
            )
        rows.append(
            FloorMachine(
                id=machine.id,
                code=machine.code,
                name=machine.name,
                machine_type=machine.machine_type,
                status=machine.status,
                floor_x=machine.floor_x,
                floor_y=machine.floor_y,
                current_order_number=order_number,
                part_count=int(count or 0),
                utilisation_today=await utilisation(session, machine.id, local_start(now), now),
            )
        )
    return FloorOut(
        machines=rows,
        orders_in_production=await session.scalar(
            select(func.count()).select_from(Order).where(Order.status == "IN_PRODUCTION")
        ),
        pending_approvals=await session.scalar(
            select(func.count()).select_from(Approval).where(Approval.status == "waiting")
        ),
    )
