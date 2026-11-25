"""Publish a machine availability change once per maintenance record and window."""

from sqlalchemy import select

from app.core.audit import write_audit
from app.core.db import session_scope
from app.models import AuditLog, MaintenanceEvent
from app.orchestrator.outbox import emit


async def scan():
    async with session_scope() as session:
        events = (
            await session.scalars(
                select(MaintenanceEvent)
                .where(MaintenanceEvent.maintenance_type.in_(("breakdown", "planned")))
                .order_by(MaintenanceEvent.start_at)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for event in events:
            data = {
                "machine_id": str(event.machine_id),
                "from": event.start_at.isoformat(),
                "to": event.end_at.isoformat() if event.end_at else None,
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
