from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update

from app.core.config import settings
from app.models import Approval, Machine, Notification, Order, ScheduleSlot
from app.orchestrator.attention import attention_items, briefing_text, send_morning_briefing


async def add_order(session, number, status, due, **kwargs):
    order = Order(order_number=number, status=status, due_date=due, **kwargs)
    session.add(order)
    await session.flush()
    return order


async def factory_with_problems(session):
    today = datetime.now(UTC).date()
    machine = Machine(code="LATHE-09", name="Lathe", machine_type="lathe", status="down")
    session.add(machine)
    overdue = await add_order(session, "SO-OVERDUE", "IN_PRODUCTION", today - timedelta(days=1))
    late_plan = await add_order(session, "SO-LATEPLAN", "CONFIRMED", today + timedelta(days=1))
    fine = await add_order(session, "SO-FINE", "CONFIRMED", today + timedelta(days=10))
    waiting = await add_order(session, "SO-WAITING", "WAITING_APPROVAL", today + timedelta(days=5))
    await add_order(session, "SO-FIELDS", "NEEDS_FIELD_CHECK", today + timedelta(days=5))
    silent = await add_order(session, "SO-SILENT", "WAITING_CUSTOMER", today + timedelta(days=5))
    await session.flush()
    for order, days in ((late_plan, 3), (fine, 2)):
        session.add(
            ScheduleSlot(
                order_id=order.id,
                machine_id=machine.id,
                routing_step=1,
                quantity=1,
                start_at=datetime.now(UTC) + timedelta(days=days - 1),
                end_at=datetime.now(UTC) + timedelta(days=days),
                status="locked",
            )
        )
    session.add(Approval(order_id=waiting.id, approval_type="replan"))
    await session.flush()
    await session.execute(
        update(Order).where(Order.id == silent.id).values(updated_at=datetime.now(UTC) - timedelta(days=3))
    )
    await session.commit()
    return overdue


async def test_attention_lists_what_needs_a_person(db_session, client, auth_headers):
    await factory_with_problems(db_session)
    response = await client.get("/api/attention", headers=auth_headers("planner"))
    assert response.status_code == 200, response.text
    titles = [entry["title"] for entry in response.json()]
    assert "LATHE-09 is down" in titles
    assert "SO-OVERDUE may miss its date" in titles
    assert "SO-LATEPLAN may miss its date" in titles
    assert "Replan approval for SO-WAITING is waiting" in titles
    assert "SO-FIELDS: Check the fields read from the PO" in titles
    assert "SO-SILENT: customer has not answered" in titles
    assert not any("SO-FINE" in title for title in titles)
    severities = [entry["severity"] for entry in response.json()]
    assert severities == sorted(severities, key=lambda severity: severity != "high")
    assert (await client.get("/api/attention", headers=auth_headers("store"))).status_code == 403


async def test_morning_briefing_is_sent_once_a_day(db_session, users):
    await factory_with_problems(db_session)
    zone = ZoneInfo(settings.app_timezone)
    day = datetime.now(zone).date()
    await send_morning_briefing(datetime.combine(day, datetime.min.time().replace(hour=7), zone))
    count = select(func.count()).select_from(Notification).where(Notification.kind == "morning_briefing")
    assert await db_session.scalar(count) == 0
    await send_morning_briefing(datetime.combine(day, datetime.min.time().replace(hour=9), zone))
    await send_morning_briefing(datetime.combine(day, datetime.min.time().replace(hour=10), zone))
    sent = list(await db_session.scalars(select(Notification).where(Notification.kind == "morning_briefing")))
    assert sent and len({row.user_id for row in sent}) == len(sent)
    assert "1 machine(s) down" in sent[0].body and "approval(s) waiting" in sent[0].body


def test_briefing_text_when_all_is_well():
    assert briefing_text([]) == "Nothing needs attention. All orders are on track."


async def test_no_items_for_a_quiet_factory(db_session):
    await add_order(db_session, "SO-QUIET", "CONFIRMED", date.today() + timedelta(days=30))
    await db_session.commit()
    assert await attention_items(db_session) == []
