"""Audit log helper. Every human and agent action should call write_audit."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


async def write_audit(
    session: AsyncSession,
    actor: User | str,
    action: str,
    entity: str,
    entity_id: uuid.UUID | str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditLog:
    """`actor` is a User for people, or an agent name such as "material" for agents.

    The row is added to the session; the caller commits.
    """
    entry = AuditLog(
        user_id=actor.id if isinstance(actor, User) else None,
        agent=None if isinstance(actor, User) else actor,
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        before=before,
        after=after,
    )
    session.add(entry)
    return entry
