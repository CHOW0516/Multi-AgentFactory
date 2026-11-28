"""The "needs attention" list and the morning briefing.

Built from database queries and fixed sentences only. No AI calls.
"""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on

from app.agents.monitoring.energy import energy_alerts
from app.core.config import settings
from app.core.db import session_scope
from app.models import CLOSED_ORDER_STATES, AgentMessage, Approval, AuditLog, Machine, Order, ScheduleSlot

from .outbox import notify
from .workflow import roles

BRIEFING_HOUR = 8  # local time
WAITING_CUSTOMER_DAYS = 2
# Orders in these states are covered by another item (approval, failure) or have no plan yet.
NOT_PLANNED_STATES = ("RECEIVED", "EXTRACTED", "NEEDS_FIELD_CHECK", "SENDER_REVIEW", "VERIFIED")
# Order states that wait for a person, with the sentence and button for each.
PERSON_STEPS = {
    "NEEDS_FIELD_CHECK": ("Check the fields read from the PO", "Check fields"),
    "SENDER_REVIEW": ("PO came from an unknown sender. Accept or reject it", "Review sender"),
    "FAILED": ("Workflow failed. Retry or cancel the order", "Open order"),
    "REPLY_DRAFTED": ("Customer reply is drafted and not sent yet", "Send reply"),
}


def item(severity, kind, title, detail, link, action):
    return dict(severity=severity, kind=kind, title=title, detail=detail, link=link, action=action)


def local_day(stamp, zone):
    return stamp.astimezone(zone).date()


async def attention_items(session, now=None) -> list[dict]:
    now = now or datetime.now(UTC)
    zone = ZoneInfo(settings.app_timezone)
    today = local_day(now, zone)
    items = []

    for machine in await session.scalars(
        select(Machine).where(Machine.status.in_(("down", "maintenance"))).order_by(Machine.code)
    ):
        items.append(
            item(
                "high",
                "machine_down",
                f"{machine.code} is {machine.status}",
                "Jobs on this machine are being replanned. Check the replan approvals.",
                "/factory-floor",
                "Open floor",
            )
        )

    last_slot_end = (
        select(ScheduleSlot.order_id, func.max(ScheduleSlot.end_at).label("end_at"))
        .where(ScheduleSlot.status.in_(("locked", "done")))
        .group_by(ScheduleSlot.order_id)
        .subquery()
    )
    open_orders = await session.execute(
        select(Order, last_slot_end.c.end_at)
        .outerjoin(last_slot_end, last_slot_end.c.order_id == Order.id)
        .where(
            Order.status.not_in((*CLOSED_ORDER_STATES, *NOT_PLANNED_STATES, "FAILED")),
            func.coalesce(Order.promised_date, Order.due_date).is_not(None),
        )
        .order_by(Order.order_number)
    )
    for order, end_at in open_orders:
        target = order.promised_date or order.due_date
        word = "promised" if order.promised_date else "due"
        if target < today:
            detail = f"It was {word} on {target:%d %b} and is not finished."
        elif end_at is not None and local_day(end_at, zone) > target:
            detail = f"Planned to finish on {local_day(end_at, zone):%d %b}, but {word} on {target:%d %b}."
        else:
            continue
        items.append(
            item("high", "order_at_risk", f"{order.order_number} may miss its date", detail,
                 f"/orders/{order.id}", "Open order")
        )

    for approval, order in await session.execute(
        select(Approval, Order)
        .join(Order, Approval.order_id == Order.id)
        .where(Approval.status == "waiting")
        .order_by(Approval.created_at)
    ):
        hours = max(0, int((now - approval.created_at).total_seconds() // 3600))
        kind = "Replan" if approval.approval_type == "replan" else "Order"
        items.append(
            item(
                "high" if approval.approval_type == "replan" else "medium",
                "approval_waiting",
                f"{kind} approval for {order.order_number} is waiting",
                f"Waiting {hours} h.",
                f"/approvals/{approval.id}",
                "Decide",
            )
        )

    latest_checks = await session.scalars(
        select(AgentMessage)
        .join(Order, AgentMessage.order_id == Order.id)
        .where(
            AgentMessage.action == "check_and_hold",
            AgentMessage.message_type == "result",
            AgentMessage.status.in_(("ok", "partial")),
            Order.status.not_in((*CLOSED_ORDER_STATES, "FAILED")),
        )
        .ext(distinct_on(AgentMessage.order_id))
        .order_by(AgentMessage.order_id, AgentMessage.sent_at.desc())
    )
    short_orders = [row.order_id for row in latest_checks if row.payload.get("shortages")]
    for order in await session.scalars(
        select(Order).where(Order.id.in_(short_orders)).order_by(Order.order_number)
    ):
        items.append(
            item(
                "medium",
                "material_short",
                f"{order.order_number} is short of material",
                "Check the purchase requests for this order.",
                f"/orders/{order.id}",
                "Open order",
            )
        )

    for order in await session.scalars(
        select(Order).where(Order.status.in_(PERSON_STEPS)).order_by(Order.order_number)
    ):
        sentence, action = PERSON_STEPS[order.status]
        items.append(
            item("medium", "person_needed", f"{order.order_number}: {sentence}", None,
                 f"/orders/{order.id}", action)
        )

    quiet_since = now - timedelta(days=WAITING_CUSTOMER_DAYS)
    for order in await session.scalars(
        select(Order)
        .where(Order.status == "WAITING_CUSTOMER", Order.updated_at < quiet_since)
        .order_by(Order.order_number)
    ):
        days = (now - order.updated_at).days
        items.append(
            item(
                "medium",
                "customer_silent",
                f"{order.order_number}: customer has not answered",
                f"No answer for {days} days. Consider a follow-up.",
                f"/orders/{order.id}",
                "Open order",
            )
        )

    items.extend(await energy_alerts(session, now))

    items.sort(key=lambda entry: entry["severity"] != "high")
    return items


def briefing_text(items) -> str:
    counts = {}
    for entry in items:
        counts[entry["kind"]] = counts.get(entry["kind"], 0) + 1
    labels = [
        ("order_at_risk", "order(s) at risk"),
        ("machine_down", "machine(s) down"),
        ("approval_waiting", "approval(s) waiting"),
        ("material_short", "order(s) short of material"),
        ("person_needed", "order(s) waiting for a person"),
        ("customer_silent", "customer(s) not answering"),
        ("energy_idle", "machine(s) switched on with no job"),
        ("energy_abnormal", "machine(s) using more power than normal"),
    ]
    parts = [f"{counts[kind]} {label}" for kind, label in labels if counts.get(kind)]
    return ", ".join(parts) + "." if parts else "Nothing needs attention. All orders are on track."


async def send_morning_briefing(now=None):
    """Once a day, from BRIEFING_HOUR local time, tell managers and planners what needs attention."""
    now = now or datetime.now(UTC)
    zone = ZoneInfo(settings.app_timezone)
    local_now = now.astimezone(zone)
    if local_now.time() < time(BRIEFING_HOUR):
        return
    day = local_now.date().isoformat()
    async with session_scope() as session:
        sent = await session.scalar(
            select(AuditLog.id)
            .where(AuditLog.entity == "morning_briefing", AuditLog.entity_id == day)
            .with_for_update()
        )
        if sent:
            return
        items = await attention_items(session, now)
        session.add(
            AuditLog(
                agent="orchestrator",
                action="sent",
                entity="morning_briefing",
                entity_id=day,
                after={"items": len(items)},
            )
        )
        notify(
            session,
            await roles(session, "manager", "planner"),
            "morning_briefing",
            "Morning briefing",
            briefing_text(items),
            "/dashboards",
        )
