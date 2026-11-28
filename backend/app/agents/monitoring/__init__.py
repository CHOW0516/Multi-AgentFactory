"""Machine event ingestion and production progress calculations."""

import math
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Protocol

from sqlalchemy import or_, select

from app.core.audit import write_audit
from app.core.db import session_scope
from app.models import Machine, MachineEvent, MaintenanceEvent, ScheduleSlot
from app.orchestrator.outbox import emit
from app.schemas.contracts import MachineRaw

STATUSES = {"running", "idle", "setup", "down", "maintenance"}
DOWN_STATUSES = {"down", "maintenance"}


async def close_breakdowns(session, machine_id, recovered_at: datetime) -> None:
    """End every breakdown still open at recovery time, so planning can use the machine again."""
    open_breakdowns = await session.scalars(
        select(MaintenanceEvent).where(
            MaintenanceEvent.machine_id == machine_id,
            MaintenanceEvent.maintenance_type == "breakdown",
            MaintenanceEvent.start_at <= recovered_at,
            or_(MaintenanceEvent.end_at.is_(None), MaintenanceEvent.end_at > recovered_at),
        )
    )
    for breakdown in open_breakdowns:
        breakdown.end_at = recovered_at
        hours = (recovered_at - breakdown.start_at).total_seconds() / 3600
        breakdown.downtime_hours = Decimal(str(round(hours, 2)))
        await write_audit(
            session,
            "monitoring",
            "close_breakdown",
            "maintenance_event",
            breakdown.id,
            None,
            {"end_at": recovered_at.isoformat()},
        )


class MachineDataSource(Protocol):
    async def submit(self, data: MachineRaw) -> None: ...


class ManualSource:
    def __init__(self, session):
        self.session = session

    async def submit(self, data: MachineRaw) -> None:
        emit(self.session, "event.machine.raw", data.model_dump(mode="json"), actor="api")


class OpcUaSource:
    async def submit(self, data: MachineRaw) -> None:
        raise RuntimeError("OPC UA not configured")


async def slot_for(session, machine_id, at):
    """The job a machine event belongs to: the latest job that has started.

    After its planned end a job only keeps receiving events while it is unfinished (running late).
    Once it has reported its full quantity, later events between jobs belong to no order.
    """
    slot = await session.scalar(
        select(ScheduleSlot)
        .where(
            ScheduleSlot.machine_id == machine_id,
            ScheduleSlot.status == "locked",
            ScheduleSlot.start_at <= at,
        )
        .order_by(ScheduleSlot.start_at.desc(), ScheduleSlot.id)
        .limit(1)
    )
    if slot is None or slot.end_at > at:
        return slot
    reported = await session.scalar(
        select(MachineEvent.value)
        .where(
            MachineEvent.machine_id == machine_id,
            MachineEvent.order_id == slot.order_id,
            MachineEvent.event_type == "count",
            MachineEvent.happened_at >= slot.start_at,
            MachineEvent.happened_at <= at,
        )
        .order_by(MachineEvent.happened_at.desc())
        .limit(1)
    )
    if reported is not None and int(reported) >= slot.quantity:
        return None
    return slot


def minutes_behind(slot, count: int, at: datetime) -> int:
    if slot.quantity <= 0 or count >= slot.quantity:
        return 0
    duration_minutes = (slot.end_at - slot.start_at).total_seconds() / 60
    elapsed_minutes = (at - slot.start_at).total_seconds() / 60
    return max(0, int(elapsed_minutes - float(count / slot.quantity) * duration_minutes))


def expected_end(slot, count: int, at: datetime, delay_minutes: int) -> datetime:
    """When the job should finish if it keeps the pace seen so far.

    Never earlier than the planned end plus the delay already seen. Capped at twice the planned
    run time, because a pace read from the first few parts can be far off.
    """
    at_least = slot.end_at + timedelta(minutes=delay_minutes)
    if count <= 0:
        return at_least
    at_pace = slot.start_at + (at - slot.start_at) * (float(slot.quantity) / count)
    at_most = slot.end_at + (slot.end_at - slot.start_at)
    return min(max(at_least, at_pace), max(at_least, at_most))


async def handle(message):
    raw = MachineRaw.model_validate(message.payload)
    if raw.at.tzinfo is None:
        raise ValueError("Machine events require a timezone")
    async with session_scope() as session:
        machine = await session.scalar(select(Machine).where(Machine.id == raw.machine_id).with_for_update())
        if machine is None or await session.get(MachineEvent, message.message_id):
            return
        slot = await slot_for(session, machine.id, raw.at)
        if raw.kind == "status":
            if raw.value not in STATUSES:
                raise ValueError("Unknown machine status")
            latest = await session.scalar(
                select(MachineEvent.happened_at)
                .where(MachineEvent.machine_id == machine.id, MachineEvent.event_type == "status")
                .order_by(MachineEvent.happened_at.desc())
                .limit(1)
            )
            if (latest is None or latest <= raw.at) and machine.status != raw.value:
                before = machine.status
                machine.status = raw.value
                emit(
                    session,
                    "event.machine.status_changed",
                    dict(machine_id=machine.id, status=raw.value),
                    actor="monitoring",
                )
                await write_audit(
                    session,
                    "monitoring",
                    "status_changed",
                    "machine",
                    machine.id,
                    {"status": before},
                    {"status": raw.value},
                )
                if before in DOWN_STATUSES and raw.value not in DOWN_STATUSES:
                    await close_breakdowns(session, machine.id, raw.at)
                if raw.value == "down":
                    breakdown = await session.scalar(
                        select(MaintenanceEvent.id)
                        .where(
                            MaintenanceEvent.machine_id == machine.id,
                            MaintenanceEvent.start_at == raw.at,
                            MaintenanceEvent.maintenance_type == "breakdown",
                        )
                        .limit(1)
                    )
                    if breakdown is None:
                        session.add(
                            MaintenanceEvent(
                                machine_id=machine.id,
                                maintenance_type="breakdown",
                                start_at=raw.at,
                                note="Machine reported down",
                            )
                        )
        elif raw.kind == "power":
            kilowatts = float(raw.value)
            if not math.isfinite(kilowatts) or kilowatts < 0:
                raise ValueError("Power readings must be 0 kW or more")
        elif int(raw.value) < 0:
            raise ValueError("Production counts cannot be negative")
        if raw.kind == "count":
            await write_audit(
                session,
                "monitoring",
                "output_recorded",
                "machine",
                machine.id,
                after={"count": int(raw.value), "order_id": str(slot.order_id) if slot else None},
            )
            if slot:
                delay = minutes_behind(slot, int(raw.value), raw.at)
                if delay > 30:
                    previous = await session.scalar(
                        select(MachineEvent)
                        .where(
                            MachineEvent.machine_id == machine.id,
                            MachineEvent.event_type == "count",
                            MachineEvent.order_id == slot.order_id,
                            MachineEvent.happened_at >= slot.start_at,
                            MachineEvent.happened_at <= raw.at,
                        )
                        .order_by(MachineEvent.happened_at.desc())
                        .limit(1)
                    )
                    if (
                        previous is None
                        or minutes_behind(slot, int(previous.value), previous.happened_at) <= 30
                    ):
                        emit(
                            session,
                            "event.order.behind_schedule",
                            dict(
                                order_id=slot.order_id,
                                minutes_behind=delay,
                                machine_id=machine.id,
                                planned_end_at=slot.end_at,
                                expected_end_at=expected_end(slot, int(raw.value), raw.at, delay),
                            ),
                            actor="monitoring",
                        )
        session.add(
            MachineEvent(
                id=message.message_id,
                machine_id=machine.id,
                event_type=raw.kind,
                value=raw.value,
                order_id=slot.order_id if slot else None,
                happened_at=raw.at,
            )
        )
