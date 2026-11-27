"""How long an open breakdown will probably last, from the machine's own past repairs."""

from datetime import datetime, timedelta

from sqlalchemy import func, select

from app.models import MaintenanceEvent

HISTORY_DAYS = 90
DEFAULT_REPAIR_HOURS = 1.5  # same starting guess as delivery confidence


async def typical_repair_hours(session, machine_ids, now: datetime, min_minutes: float) -> dict:
    """Average length of each machine's finished breakdowns of at least `min_minutes`, last 90 days."""
    rows = await session.execute(
        select(MaintenanceEvent.machine_id, func.avg(MaintenanceEvent.downtime_hours))
        .where(
            MaintenanceEvent.machine_id.in_(list(machine_ids)),
            MaintenanceEvent.maintenance_type == "breakdown",
            MaintenanceEvent.end_at.is_not(None),
            MaintenanceEvent.start_at >= now - timedelta(days=HISTORY_DAYS),
            MaintenanceEvent.downtime_hours >= min_minutes / 60,
        )
        .group_by(MaintenanceEvent.machine_id)
    )
    return {machine_id: float(hours) for machine_id, hours in rows.all() if hours}


def expected_end(start: datetime, now: datetime, typical_hours: float | None) -> datetime:
    """A whole number of typical repairs after the start, the first one still ahead of now.

    The estimate only moves when the breakdown outlasts it, so a long repair causes a few replans,
    not one per scan.
    """
    step = timedelta(hours=typical_hours or DEFAULT_REPAIR_HOURS)
    end = start + step
    while end <= now:
        end += step
    return end
