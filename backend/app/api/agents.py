import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote, unquote, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from app.api.machine_ops import local_start
from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user
from app.models import AgentMessage, AuditLog, LlmCall, Order, SourceDocument, User
from app.schemas.api import AgentMessageOut, AgentSummary, Page, TimelineEntry

router = APIRouter(tags=["agents"])
AGENTS = {
    "orchestrator": ("Coordinates order workflows, approvals and chat.", True),
    "order": ("Extracts purchase orders and drafts customer replies.", True),
    "material": ("Checks inventory, holds materials and prepares purchase requests.", False),
    "planning": ("Schedules orders and explains options and their impact.", True),
    "quality": ("Plans inspections and verifies QC before orders close.", False),
    "monitoring": ("Records machine data and detects delays.", False),
    "maintenance": ("Publishes machine unavailability from maintenance windows.", False),
}


async def queue_counts():
    from app.messaging import InMemoryBroker, get_broker

    broker = get_broker()
    if isinstance(broker, InMemoryBroker):
        counts = {}
        for name, _ in broker.dead_letters:
            counts[f"{name}.dlq"] = (counts.get(f"{name}.dlq", (0, 0))[0] + 1, 0)
        return counts
    address = urlsplit(settings.rabbitmq_url)
    host = f"[{address.hostname}]" if ":" in address.hostname else address.hostname
    vhost = quote(unquote(address.path.removeprefix("/")) or "/", safe="")
    scheme = "https" if address.scheme == "amqps" else "http"
    port = 15671 if scheme == "https" else 15672
    try:
        async with httpx.AsyncClient(timeout=2.0, trust_env=False) as client:
            response = await client.get(
                f"{scheme}://{host}:{port}/api/queues/{vhost}",
                auth=(unquote(address.username or "guest"), unquote(address.password or "guest")),
            )
            response.raise_for_status()
            return {
                row["name"]: (row.get("messages_ready", 0), row.get("messages_unacknowledged", 0))
                for row in response.json()
            }
    except (httpx.HTTPError, ValueError):
        return {}


def agent_catalog():
    if settings.app_mode == "demo":
        return AGENTS | {"simulator": ("Produces demo purchase orders and machine events.", False)}
    return AGENTS


def scope(name):
    catalog = agent_catalog()
    if name not in catalog:
        raise HTTPException(404, "Agent not found")
    return catalog[name]


def messages_for(name):
    return or_(AgentMessage.from_agent == name, AgentMessage.to_agent == name)


async def stats(session, names, queues, user):
    now = datetime.now(UTC)
    start = local_start(now)
    results = {
        row[0]: row[1:]
        for row in (
            await session.execute(
                select(
                    AgentMessage.from_agent,
                    func.count(),
                    func.count().filter(AgentMessage.status == "ok"),
                    func.avg(AgentMessage.latency_ms),
                    func.coalesce(func.sum(AgentMessage.tokens_in + AgentMessage.tokens_out), 0),
                    func.coalesce(func.sum(AgentMessage.cost_usd), 0),
                )
                .where(
                    AgentMessage.from_agent.in_(names),
                    AgentMessage.message_type == "result",
                    AgentMessage.sent_at >= start,
                )
                .group_by(AgentMessage.from_agent)
            )
        ).all()
    }
    orchestrator_usage = None
    if "orchestrator" in names:
        orchestrator_usage = (
            await session.execute(
                select(
                    func.coalesce(func.sum(LlmCall.tokens_in + LlmCall.tokens_out), 0),
                    func.coalesce(func.sum(LlmCall.cost_usd), 0),
                ).where(LlmCall.purpose == "orchestrator", LlmCall.created_at >= start)
            )
        ).one()
    last_seen = dict(
        (
            await session.execute(
                select(AgentMessage.from_agent, func.max(AgentMessage.sent_at))
                .where(AgentMessage.from_agent.in_(names))
                .group_by(AgentMessage.from_agent)
            )
        ).all()
    )
    task = aliased(AgentMessage)
    result = aliased(AgentMessage)
    pending = dict(
        (
            await session.execute(
                select(task.to_agent, func.count())
                .select_from(task)
                .where(
                    task.message_type == "task",
                    task.to_agent.in_(names),
                    task.sent_at > now - timedelta(seconds=settings.task_default_timeout_seconds),
                    ~select(result.id).where(result.in_reply_to == task.message_id).exists(),
                )
                .group_by(task.to_agent)
            )
        ).all()
    )
    summaries = []
    for name in names:
        job_scope, uses_llm = scope(name)
        done, ok, latency, tokens, cost = results.get(name, (0, 0, 0, 0, 0))
        if name == "orchestrator":
            tokens, cost = orchestrator_usage
        queue = "orchestrator.results" if name == "orchestrator" else f"agent.{name}"
        depth, active = queues.get(queue, (0, pending.get(name, 0)))
        summaries.append(
            AgentSummary(
                name=name,
                job_scope=job_scope,
                uses_llm=uses_llm,
                queue_depth=depth,
                in_progress=active,
                success_rate_today=100 * ok / done if done else 0,
                average_latency_ms=float(latency or 0),
                tokens_today=tokens,
                cost_today_usd=0 if user.role == "store" else float(cost),
                dead_letter_count=sum(queues.get(f"{queue}.dlq", (0, 0))),
                last_seen=last_seen.get(name),
            )
        )
    return summaries


@router.get("/agents", response_model=list[AgentSummary])
async def agents(session=Depends(get_session), user=Depends(current_user)):
    queues = await queue_counts()
    return await stats(session, list(agent_catalog()), queues, user)


@router.get("/agents/{name}", response_model=AgentSummary)
async def agent(name: str, session=Depends(get_session), user=Depends(current_user)):
    scope(name)
    return (await stats(session, [name], await queue_counts(), user))[0]


def show_message(row, user):
    message = AgentMessageOut.model_validate(row)
    if user.role == "store":
        return message.model_copy(update={"payload": {}, "notes": None, "cost_usd": 0})
    return message


async def message_page(session, user, filters, page, page_size, *, replay=False):
    total = await session.scalar(select(func.count()).select_from(AgentMessage).where(*filters))
    ordering = AgentMessage.sent_at if replay else AgentMessage.sent_at.desc()
    rows = await session.scalars(
        select(AgentMessage)
        .where(*filters)
        .order_by(ordering, AgentMessage.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return dict(items=[show_message(row, user) for row in rows], total=total, page=page, page_size=page_size)


@router.get("/agents/{name}/messages", response_model=Page[AgentMessageOut])
async def agent_messages(
    name: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session=Depends(get_session),
    user=Depends(current_user),
):
    scope(name)
    return await message_page(session, user, [messages_for(name)], page, page_size)


@router.get("/orders/{order_id}/messages", response_model=Page[AgentMessageOut])
async def order_messages(
    order_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session=Depends(get_session),
    user=Depends(current_user),
):
    if await session.get(Order, order_id) is None:
        raise HTTPException(404, "Order not found")
    return await message_page(
        session, user, [AgentMessage.order_id == order_id], page, page_size, replay=True
    )


@router.get("/orders/{order_id}/timeline", response_model=list[TimelineEntry])
async def timeline(order_id: uuid.UUID, session=Depends(get_session), user=Depends(current_user)):
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    entries = []
    document = (
        await session.get(SourceDocument, order.source_document_id) if order.source_document_id else None
    )
    if document and user.role != "store":
        entries.append(
            TimelineEntry(
                at=document.created_at,
                kind="document",
                title=document.file_name,
                detail={"url": f"/orders/{order.id}/document"},
                actor=None,
            )
        )
    audits = await session.execute(
        select(AuditLog, User.name)
        .outerjoin(User)
        .where(AuditLog.entity.in_(("order", "orders")), AuditLog.entity_id == str(order_id))
    )
    for entry, name in audits:
        if entry.action == "state_changed" or entry.user_id:
            detail = {"before": entry.before, "after": entry.after}
            if user.role == "store" and entry.action != "state_changed":
                detail = None
            entries.append(
                TimelineEntry(
                    at=entry.created_at,
                    kind="state_change" if entry.action == "state_changed" else "human_action",
                    title=entry.action,
                    detail=detail,
                    actor=name or entry.agent,
                )
            )
    for message in await session.scalars(select(AgentMessage).where(AgentMessage.order_id == order_id)):
        entries.append(
            TimelineEntry(
                at=message.sent_at,
                kind="agent_message",
                title=message.action,
                detail=show_message(message, user).model_dump(mode="json"),
                actor=message.from_agent,
            )
        )
    return sorted(entries, key=lambda entry: entry.at)
