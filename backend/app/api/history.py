import csv
import io
import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import String, cast, func, or_, select

from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user, require_roles
from app.models import AuditLog, Notification, User
from app.orchestrator.outbox import OUTBOX
from app.schemas.api import AuditEntryOut, NotificationOut, Page

router = APIRouter(tags=["history", "notifications"])
audit_reader = require_roles("manager")


def audit_query(actor=None, agent=None, user_id=None, entity=None, start=None, end=None, text=None):
    query = select(AuditLog).where(AuditLog.entity != OUTBOX, AuditLog.entity != "p3_machine_replan")
    if actor:
        people = select(User.id).where(
            or_(User.name.icontains(actor, autoescape=True), User.email.icontains(actor, autoescape=True))
        )
        query = query.where(
            or_(AuditLog.agent.icontains(actor, autoescape=True), AuditLog.user_id.in_(people))
        )
    if agent:
        query = query.where(AuditLog.agent == agent)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if entity:
        query = query.where(or_(AuditLog.entity == entity, AuditLog.entity_id == entity))
    if start:
        query = query.where(AuditLog.created_at >= history_time(start))
    if end:
        if isinstance(end, datetime):
            query = query.where(AuditLog.created_at <= history_time(end))
        else:
            query = query.where(AuditLog.created_at < history_time(end + timedelta(days=1)))
    if text:
        query = query.where(
            or_(
                *(
                    column.icontains(text, autoescape=True)
                    for column in (
                        AuditLog.action,
                        AuditLog.entity,
                        cast(AuditLog.before, String),
                        cast(AuditLog.after, String),
                    )
                )
            )
        )
    return query.order_by(AuditLog.created_at.desc(), AuditLog.id)


def history_time(value):
    timezone = ZoneInfo(settings.app_timezone)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone)
    return datetime.combine(value, time.min, timezone)


@router.get("/history", response_model=Page[AuditEntryOut])
async def history(
    actor: str | None = None,
    agent: str | None = None,
    user_id: uuid.UUID | None = None,
    entity: str | None = None,
    start: date | datetime | None = Query(None, alias="from"),
    end: date | datetime | None = Query(None, alias="to"),
    q: str | None = None,
    text: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session=Depends(get_session),
    user=Depends(audit_reader),
):
    query = audit_query(actor, agent, user_id, entity, start, end, q or text)
    total = await session.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    items = list(await session.scalars(query.offset((page - 1) * page_size).limit(page_size)))
    return dict(items=items, total=total, page=page, page_size=page_size)


def csv_value(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, default=str)
    text = str(value) if value is not None else ""
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


@router.get("/history/export.csv")
async def export_csv(
    actor: str | None = None,
    agent: str | None = None,
    user_id: uuid.UUID | None = None,
    entity: str | None = None,
    start: date | datetime | None = Query(None, alias="from"),
    end: date | datetime | None = Query(None, alias="to"),
    q: str | None = None,
    text: str | None = None,
    session=Depends(get_session),
    user=Depends(audit_reader),
):
    output = io.StringIO()
    writer = csv.writer(output)
    fields = list(AuditEntryOut.model_fields)
    writer.writerow(fields)
    query = audit_query(actor, agent, user_id, entity, start, end, q or text)
    async for entry in await session.stream_scalars(query):
        writer.writerow([csv_value(getattr(entry, field)) for field in fields])
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit-log.csv"},
    )


@router.get("/notifications", response_model=list[NotificationOut])
async def notifications(
    unread: bool = False,
    limit: int = Query(100, ge=1, le=200),
    session=Depends(get_session),
    user=Depends(current_user),
):
    query = select(Notification).where(Notification.user_id == user.id)
    if unread:
        query = query.where(Notification.read_at.is_(None))
    return list(await session.scalars(query.order_by(Notification.created_at.desc()).limit(limit)))


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: uuid.UUID, session=Depends(get_session), user=Depends(current_user)):
    row = await session.scalar(
        select(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user.id)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(404, "Notification not found")
    if not row.read_at:
        row.read_at = datetime.now(UTC)
        await write_audit(session, user, "read", "notification", row.id)
        await session.commit()
    return row
