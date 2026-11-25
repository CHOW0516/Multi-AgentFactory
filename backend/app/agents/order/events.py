"""Persist order events with the originating mutation and deliver after commit."""

import logging
from uuid import UUID

from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.db import session_scope
from app.messaging import publish_event
from app.models import AuditLog

logger = logging.getLogger(__name__)
OUTBOX = "order_event_outbox"


async def stage_event(
    session: AsyncSession,
    order_id: UUID,
    routing_key: str,
    *,
    from_agent: str,
    **data: UUID,
) -> None:
    payload = {"order_id": str(order_id), **{key: str(value) for key, value in data.items()}}
    previous = await session.scalar(
        select(AuditLog.id)
        .where(
            AuditLog.entity == OUTBOX,
            AuditLog.entity_id == str(order_id),
            AuditLog.after["routing_key"].as_string() == routing_key,
            AuditLog.after["data"] == payload,
        )
        .limit(1)
    )
    if previous is None:
        await write_audit(
            session,
            from_agent,
            "pending",
            OUTBOX,
            order_id,
            None,
            {
                "routing_key": routing_key,
                "data": payload,
            },
        )


async def flush_events(order_id: UUID | None = None, *, retry: bool = False) -> None:
    async with session_scope() as session:
        query = select(AuditLog.id).where(AuditLog.entity == OUTBOX, AuditLog.action == "pending")
        if order_id is not None:
            query = query.where(AuditLog.entity_id == str(order_id))
        priority = case(
            {"event.order.received": 0, "event.order.revised": 1, "event.order.fields_corrected": 2},
            value=AuditLog.after["routing_key"].as_string(),
        )
        pending_ids = list(
            await session.scalars(query.order_by(priority, AuditLog.created_at, AuditLog.id).limit(200))
        )
    failed_orders = set()
    for entry_id in pending_ids:
        entity_id = None
        try:
            async with session_scope() as session:
                entry = await session.get(AuditLog, entry_id, with_for_update=True)
                if entry is None or entry.action != "pending" or entry.entity_id in failed_orders:
                    continue
                entity_id = entry.entity_id
                await publish_event(entry.after["routing_key"], entry.after["data"], from_agent=entry.agent)
                entry.action = "published"
        except Exception:
            if not retry:
                raise
            if entity_id is not None:
                failed_orders.add(entity_id)
            logger.exception("Order event is still pending for outbox entry %s", entry_id)
