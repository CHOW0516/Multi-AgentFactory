"""Publish a machine availability change once per maintenance record and window.

Short stops are not breakdowns for planning: an open breakdown is only published once it has
lasted `breakdown_min_minutes`. Its end is then estimated from the machine's past repairs instead
of "never", so planning moves only the work that the repair really blocks.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from app.agents.maintenance.repair import expected_end, typical_repair_hours
from app.api.settings import effective_settings
from app.core.audit import write_audit
from app.core.db import session_scope
from app.models import AuditLog, MaintenanceEvent
from app.orchestrator.outbox import emit


async def scan(now=None):
    now = now or datetime.now(UTC)
    async with session_scope() as session:
        events = (
            await session.scalars(
                select(MaintenanceEvent)
                .where(
                    MaintenanceEvent.maintenance_type.in_(("breakdown", "planned")),
                    # Only windows that still affect the future. A breakdown closed in the past
                    # needs no replan, and skipping old rows keeps the scan cheap.
                    or_(MaintenanceEvent.end_at.is_(None), MaintenanceEvent.end_at > now),
                )
                .order_by(MaintenanceEvent.start_at)
                .with_for_update(skip_locked=True)
            )
        ).all()
        if not events:
            return
        min_minutes = (await effective_settings(session))["breakdown_min_minutes"]
        repairs = await typical_repair_hours(
            session, {event.machine_id for event in events}, now, min_minutes
        )
        for event in events:
            to = event.end_at
            if event.maintenance_type == "breakdown" and to is None:
                if now - event.start_at < timedelta(minutes=min_minutes):
                    continue  # maybe just a short stop; look again on the next scan
                to = expected_end(event.start_at, now, repairs.get(event.machine_id))
            data = {
                "machine_id": str(event.machine_id),
                "from": event.start_at.isoformat(),
                "to": to.isoformat() if to else None,
                "reason": event.note or event.maintenance_type,
            }
            last = await session.scalar(
                select(AuditLog)
                .where(
                    AuditLog.agent == "maintenance",
                    AuditLog.entity == "maintenance_event",
                    AuditLog.action == "machine_unavailable",
                    AuditLog.entity_id == str(event.id),
                )
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            )
            if last is None or last.after != data:
                await write_audit(
                    session, "maintenance", "machine_unavailable", "maintenance_event", event.id, after=data
                )
                emit(session, "event.machine.unavailable", data, actor="maintenance")
