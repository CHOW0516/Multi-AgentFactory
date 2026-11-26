from datetime import UTC, date, datetime, time, timedelta
from statistics import mean
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on

from app.api.machine_ops import local_start, utilisation
from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user
from app.models import (
    AgentMessage,
    Approval,
    AuditLog,
    ExtractedField,
    LlmCall,
    Machine,
    Order,
    PurchaseRequest,
    ScheduleSlot,
    WorkflowRun,
)
from app.schemas.api import ChartOut, ChartSeries, KpiTile

router = APIRouter(tags=["dashboard"])


def window(start, end, now):
    timezone = ZoneInfo(settings.app_timezone)
    today = now.astimezone(timezone).date()
    start, end = start or today - timedelta(days=29), end or today
    if end < start or (end - start).days > 365:
        raise HTTPException(422, "Choose a date range of up to 366 days")
    lower = datetime.combine(start, time.min, timezone).astimezone(UTC)
    upper = datetime.combine(end + timedelta(days=1), time.min, timezone).astimezone(UTC)
    return lower, upper


def average(values):
    return float(mean(values)) if values else 0.0


async def completed(session, start, end):
    return list(
        (
            await session.execute(
                select(Order.completed_at, Order.due_date, Order.promised_date).where(
                    Order.completed_at >= start,
                    Order.completed_at < end,
                    (Order.due_date.is_not(None) | Order.promised_date.is_not(None)),
                )
            )
        ).all()
    )


async def decision_times(session, start, end):
    return list(
        (
            await session.execute(
                select(Approval.decided_at, Order.created_at)
                .join(Order)
                .where(
                    Approval.approval_type == "order",
                    Approval.decision.in_(("approve", "choose_option")),
                    Approval.decided_at >= start,
                    Approval.decided_at < end,
                )
            )
        ).all()
    )


async def corrections(session, start, end):
    return list(
        (
            await session.execute(
                select(ExtractedField.created_at, ExtractedField.corrected_by.is_(None)).where(
                    ExtractedField.created_at >= start, ExtractedField.created_at < end
                )
            )
        ).all()
    )


def local_date(stamp):
    return stamp.astimezone(ZoneInfo(settings.app_timezone)).date()


async def shortages(session):
    rows = await session.scalars(
        select(AgentMessage)
        .join(Order, AgentMessage.order_id == Order.id)
        .where(
            AgentMessage.action == "check_and_hold",
            AgentMessage.message_type == "result",
            AgentMessage.status.in_(("ok", "partial")),
            Order.status.not_in(("COMPLETED", "DECLINED", "REJECTED", "FAILED", "CANCELLED")),
        )
        .ext(distinct_on(AgentMessage.order_id))
        .order_by(AgentMessage.order_id, AgentMessage.sent_at.desc())
    )
    return len({shortage["material_id"] for row in rows for shortage in row.payload.get("shortages", [])})


async def latest_stats(session, now):
    pending, oldest = (
        await session.execute(
            select(func.count(), func.min(Approval.created_at)).where(Approval.status == "waiting")
        )
    ).one()
    open_requests = await session.scalar(
        select(func.count()).select_from(PurchaseRequest).where(PurchaseRequest.status.in_(("draft", "sent")))
    )
    machines = list(await session.scalars(select(Machine.id)))
    day = local_start(now)
    week = local_start(now, local_date(now).weekday())
    return [
        ("pending_approvals", "Waiting approvals", pending, None),
        ("oldest_waiting", "Oldest waiting", (now - oldest).total_seconds() / 3600 if oldest else 0, "h"),
        (
            "utilisation_today",
            "Utilisation today",
            average([await utilisation(session, mid, day, now) for mid in machines]),
            "%",
        ),
        (
            "utilisation_week",
            "Utilisation this week",
            average([await utilisation(session, mid, week, now) for mid in machines]),
            "%",
        ),
        ("open_shortages", "Materials short", await shortages(session), None),
        ("open_purchase_requests", "Open purchase requests", open_requests, None),
    ]


async def kpi_tiles(session, user, first=None, last=None, now=None):
    now = now or datetime.now(UTC)
    start, end = window(first, last, now)
    delivery = average(
        [
            100.0 * (local_date(at) <= (promised or due))
            for at, due, promised in await completed(session, start, end)
        ]
    )
    approval = average(
        [(at - created).total_seconds() / 3600 for at, created in await decision_times(session, start, end)]
    )
    extraction = average([100.0 * unchanged for _, unchanged in await corrections(session, start, end)])
    runs = await session.scalar(
        select(func.count())
        .select_from(WorkflowRun)
        .where(
            WorkflowRun.state == "FAILED",
            WorkflowRun.updated_at >= start,
            WorkflowRun.updated_at < end,
        )
    )
    tiles = [
        ("on_time_rate", "On-time delivery", delivery, "%"),
        ("po_to_approval", "PO to approval (average)", approval, "h"),
        ("extraction_accuracy", "Fields right first time", extraction, "%"),
        ("failed_workflows", "Failed workflows", runs, None),
        *await latest_stats(session, now),
    ]
    if user.role != "store":
        total, orders = (
            await session.execute(
                select(func.sum(LlmCall.cost_usd), func.count(func.distinct(LlmCall.order_id))).where(
                    LlmCall.created_at >= start, LlmCall.created_at < end, LlmCall.order_id.is_not(None)
                )
            )
        ).one()
        tiles.append(
            ("llm_cost_per_order", "AI cost per order", float(total or 0) / orders if orders else 0, "USD")
        )
    return [
        KpiTile(key=key, label=label, value=round(value, 4), unit=unit, trend=None)
        for key, label, value, unit in tiles
    ]


@router.get("/dashboard/kpis", response_model=list[KpiTile])
async def kpis(
    first: date | None = Query(None, alias="from"),
    last: date | None = Query(None, alias="to"),
    session=Depends(get_session),
    user=Depends(current_user),
):
    return await kpi_tiles(session, user, first, last)


def group_points(rows, *, weekly=False, total=False):
    groups = {}
    for stamp, value in rows:
        day = local_date(stamp)
        key = day - timedelta(days=day.weekday()) if weekly else day
        groups.setdefault(key.isoformat(), []).append(value)
    return [
        (key, round(float(sum(values)) if total else average(values), 4))
        for key, values in sorted(groups.items())
    ]


async def machines_chart(session, name, start, end, now):
    machines = list(await session.scalars(select(Machine).order_by(Machine.code)))
    end = min(end, now)
    elapsed = max(0, (end - start).total_seconds() / 3600)
    actual = [(machine.code, await utilisation(session, machine.id, start, end)) for machine in machines]
    if name == "machine_utilisation":
        today = [
            (machine.code, await utilisation(session, machine.id, local_start(now), now))
            for machine in machines
        ]
        week_start = local_start(now, local_date(now).weekday())
        week = [
            (machine.code, await utilisation(session, machine.id, week_start, now)) for machine in machines
        ]
        return [
            ChartSeries(name="Selected period", points=actual),
            ChartSeries(name="Today", points=today),
            ChartSeries(name="Week to date", points=week),
        ]
    durations = await session.execute(
        select(
            ScheduleSlot.machine_id,
            func.sum(
                func.extract(
                    "epoch",
                    func.least(ScheduleSlot.end_at, end) - func.greatest(ScheduleSlot.start_at, start),
                )
                / 3600
            ),
        )
        .where(
            ScheduleSlot.status.in_(("done", "locked")),
            ScheduleSlot.start_at < end,
            ScheduleSlot.end_at > start,
        )
        .group_by(ScheduleSlot.machine_id)
    )
    planned = dict(durations.all())
    return [
        ChartSeries(
            name="Planned", points=[(machine.code, float(planned.get(machine.id, 0))) for machine in machines]
        ),
        ChartSeries(
            name="Actual", points=[(code, round(percent * elapsed / 100, 4)) for code, percent in actual]
        ),
    ]


@router.get("/dashboard/charts/{name}", response_model=ChartOut)
async def chart(
    name: str,
    first: date | None = Query(None, alias="from"),
    last: date | None = Query(None, alias="to"),
    session=Depends(get_session),
    user=Depends(current_user),
):
    now = datetime.now(UTC)
    start, end = window(first, last, now)
    if name in ("machine_utilisation", "planned_vs_actual"):
        return ChartOut(name=name, series=await machines_chart(session, name, start, end, now))
    if name == "on_time_delivery":
        points = group_points(
            [
                (at, 100 * (local_date(at) <= (promised or due)))
                for at, due, promised in await completed(session, start, end)
            ],
            weekly=True,
        )
    elif name == "po_to_approval_hours":
        points = group_points(
            [
                (at, (at - created).total_seconds() / 3600)
                for at, created in await decision_times(session, start, end)
            ],
            weekly=True,
        )
    elif name == "extraction_accuracy":
        points = group_points(
            [(at, 100 * unchanged) for at, unchanged in await corrections(session, start, end)], weekly=True
        )
    elif name == "failed_workflows":
        rows = (
            await session.execute(
                select(AuditLog.created_at).where(
                    AuditLog.action == "state_changed",
                    AuditLog.after["state"].as_string() == "FAILED",
                    AuditLog.created_at >= start,
                    AuditLog.created_at < end,
                )
            )
        ).all()
        points = group_points([(at, 1) for (at,) in rows], total=True)
    elif name in ("llm_cost_daily", "llm_cost_per_order"):
        if user.role == "store":
            raise HTTPException(403, "Cost data is restricted")
        ranges = (LlmCall.created_at >= start, LlmCall.created_at < end)
        if name == "llm_cost_daily":
            rows = (await session.execute(select(LlmCall.created_at, LlmCall.cost_usd).where(*ranges))).all()
            points = group_points(rows, total=True)
        else:
            rows = (
                await session.execute(
                    select(Order.order_number, func.sum(LlmCall.cost_usd))
                    .join(Order, LlmCall.order_id == Order.id)
                    .where(*ranges)
                    .group_by(Order.order_number)
                    .order_by(Order.order_number)
                )
            ).all()
            points = [(number, float(cost)) for number, cost in rows]
    elif name in ("pending_approvals", "oldest_waiting", "open_shortages", "open_purchase_requests"):
        points = [
            (local_date(now).isoformat(), value)
            for key, _, value, _ in await latest_stats(session, now)
            if key == name
        ]
    else:
        raise HTTPException(404, "Unknown dashboard chart")
    return ChartOut(name=name, series=[ChartSeries(name=name.replace("_", " "), points=points)])
