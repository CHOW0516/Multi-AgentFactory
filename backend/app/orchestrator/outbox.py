"""Stage live events with the business transaction using the shared audit table."""

from datetime import UTC, datetime

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.messaging import publish_event
from app.models import AuditLog, Notification

OUTBOX = "p3_event_outbox"


def emit(session: AsyncSession, routing_key: str, payload: dict, actor: str = "orchestrator") -> None:
    session.add(
        AuditLog(
            agent=actor,
            entity=OUTBOX,
            action=routing_key,
            after=jsonable_encoder(payload),
            created_at=datetime.now(UTC),
        )
    )


def notify(session: AsyncSession, users: list, kind: str, title: str, body=None, link=None) -> None:
    user_ids = list(dict.fromkeys(user.id for user in users))
    for user_id in user_ids:
        session.add(Notification(user_id=user_id, kind=kind, title=title, body=body, link=link))
    if user_ids:
        emit(
            session,
            "event.notification",
            dict(user_ids=user_ids, kind=kind, title=title, body=body, link=link),
        )


async def drain_events(limit: int = 100) -> None:
    for _ in range(limit):
        async with session_scope() as session:
            event = await session.scalar(
                select(AuditLog)
                .where(AuditLog.entity == OUTBOX)
                .order_by(AuditLog.created_at, AuditLog.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            if event is None:
                return
            await publish_event(event.action, event.after, from_agent=event.agent)
            await session.delete(event)
