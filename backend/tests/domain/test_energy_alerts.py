"""Power readings: storing them, waste alerts, energy per day, simulator power and the chat tool."""

import json
import random
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.agents.monitoring import handle as monitor
from app.agents.monitoring.energy import daily_energy, energy_alerts
from app.api.chat import read_tool
from app.core.config import get_settings, settings
from app.messaging.core import Envelope
from app.models import AppSetting, Machine, MachineEvent, Order, ScheduleSlot, Shift
from app.orchestrator.attention import attention_items, briefing_text
from app.simulator import runtime

# A Wednesday at 18:00 UTC: inside the default 14:00-22:00 weekday peak.
NOW = datetime(2027, 1, 6, 18, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def utc_factory(monkeypatch):
    monkeypatch.setattr(get_settings(), "app_timezone", "UTC")


async def add_machine(session, status="idle", running_kw=20):
    machine = Machine(
        code=f"M-{random.randint(0, 10**6)}",
        name="Mill",
        machine_type="milling",
        status=status,
        running_kw=Decimal(running_kw),
        idle_kw=Decimal(2),
    )
    session.add(machine)
    await session.flush()
    return machine


def power(machine, minutes_ago, kilowatts, order_id=None):
    return MachineEvent(
        machine_id=machine.id,
        event_type="power",
        value=f"{kilowatts:.2f}",
        order_id=order_id,
        happened_at=NOW - timedelta(minutes=minutes_ago),
    )


def status(machine, minutes_ago, value):
    return MachineEvent(
        machine_id=machine.id,
        event_type="status",
        value=value,
        happened_at=NOW - timedelta(minutes=minutes_ago),
    )


async def idle_and_on(session, minutes=50, kilowatts=2.0):
    machine = await add_machine(session)
    session.add(status(machine, minutes, "idle"))
    session.add_all(power(machine, ago, kilowatts) for ago in range(minutes, -1, -5))
    await session.commit()
    return machine


# ---------------------------------------------------------------- monitoring agent
async def test_monitoring_stores_power_readings_and_rejects_bad_ones(db_session):
    machine = await add_machine(db_session)
    await db_session.commit()

    def raw(value):
        return Envelope(
            type="event",
            from_agent="simulator",
            action="event.machine.raw",
            payload={"machine_id": str(machine.id), "kind": "power", "value": value, "at": NOW.isoformat()},
        )

    await monitor(raw("12.50"))
    stored = await db_session.scalar(select(MachineEvent).where(MachineEvent.machine_id == machine.id))
    assert (stored.event_type, stored.value) == ("power", "12.50")
    for bad in ("-1", "nan", "inf"):
        with pytest.raises(ValueError):
            await monitor(raw(bad))


# ---------------------------------------------------------------- idle but switched on
async def test_idle_machine_left_on_raises_an_alert(db_session):
    machine = await idle_and_on(db_session)
    (alert,) = await energy_alerts(db_session, NOW)
    assert alert["kind"] == "energy_idle"
    assert alert["title"] == f"{machine.code} is switched on outside shift hours"
    assert "On and idle for 50 min" in alert["detail"] and "No job is planned" in alert["detail"]
    assert "about 1.7 kWh (0.83 MYR)" in alert["detail"]  # 2 kW for 50 min, all in peak at 0.50


async def test_idle_alert_says_no_job_during_a_shift(db_session):
    db_session.add(Shift(name="Day", weekday=NOW.weekday(), start_time=time(8), end_time=time(23)))
    machine = await idle_and_on(db_session)
    (alert,) = await energy_alerts(db_session, NOW)
    assert alert["title"] == f"{machine.code} is switched on with no job running"


async def test_no_idle_alert_before_the_limit_or_while_warming_up(db_session):
    await idle_and_on(db_session, minutes=20)
    assert await energy_alerts(db_session, NOW) == []
    machine = await idle_and_on(db_session)
    order = Order(order_number="SO-WARM", status="CONFIRMED")
    db_session.add(order)
    await db_session.flush()
    db_session.add(
        ScheduleSlot(
            order_id=order.id,
            machine_id=machine.id,
            routing_step=1,
            quantity=1,
            start_at=NOW + timedelta(minutes=10),
            end_at=NOW + timedelta(hours=1),
            status="locked",
        )
    )
    await db_session.commit()
    assert await energy_alerts(db_session, NOW) == []


async def test_no_idle_alert_when_switched_off_or_the_meter_is_silent(db_session):
    await idle_and_on(db_session, kilowatts=0)
    silent = await add_machine(db_session)
    db_session.add(status(silent, 90, "idle"))
    db_session.add_all(power(silent, ago, 2) for ago in range(90, 19, -5))  # last reading 20 min ago
    await db_session.commit()
    assert await energy_alerts(db_session, NOW) == []


# ---------------------------------------------------------------- abnormal draw
async def test_running_far_above_normal_raises_an_alert(db_session):
    machine = await add_machine(db_session, status="running")
    db_session.add_all(power(machine, ago, 30) for ago in range(20, -1, -5))
    await db_session.commit()
    (alert,) = await energy_alerts(db_session, NOW)
    assert alert["kind"] == "energy_abnormal"
    assert alert["title"] == f"{machine.code} uses 50% more power than normal"
    assert "normal is 20.0 kW" in alert["detail"]


async def test_normal_comes_from_the_machines_own_history(db_session):
    machine = await add_machine(db_session, status="running")
    # A week of readings at 28 kW makes 28 kW normal for this machine, so 30 kW is fine.
    db_session.add_all(power(machine, ago, 28) for ago in range(60 * 24, 30, -30))
    db_session.add_all(power(machine, ago, 30) for ago in range(20, -1, -5))
    await db_session.commit()
    assert await energy_alerts(db_session, NOW) == []


async def test_short_spike_or_small_rise_is_not_an_alert(db_session):
    spike = await add_machine(db_session, status="running")
    db_session.add_all(power(spike, ago, 20) for ago in range(30, 9, -5))
    db_session.add_all(power(spike, ago, 35) for ago in (5, 0))
    small = await add_machine(db_session, status="running")
    db_session.add_all(power(small, ago, 22) for ago in range(30, -1, -5))  # +10%
    await db_session.commit()
    assert await energy_alerts(db_session, NOW) == []


async def test_alerts_follow_the_settings(db_session):
    await idle_and_on(db_session)
    db_session.add(AppSetting(key="energy_idle_alert_minutes", value="60"))
    await db_session.commit()
    assert await energy_alerts(db_session, NOW) == []
    row = await db_session.scalar(select(AppSetting).where(AppSetting.key == "energy_idle_alert_minutes"))
    row.value = "30"
    db_session.add(AppSetting(key="energy_enabled", value="0"))
    await db_session.commit()
    assert await energy_alerts(db_session, NOW) == []


async def test_alerts_show_in_needs_attention_and_the_briefing(db_session):
    await idle_and_on(db_session)
    items = await attention_items(db_session, NOW)
    assert [entry["kind"] for entry in items] == ["energy_idle"]
    assert briefing_text(items) == "1 machine(s) switched on with no job."


# ---------------------------------------------------------------- energy per day
async def test_daily_energy_splits_peak_and_counts_time_with_no_job(db_session):
    machine = await add_machine(db_session, status="running")
    order = Order(order_number="SO-E1", status="IN_PRODUCTION")
    db_session.add(order)
    await db_session.flush()
    # 10 kW from 17:00 to 17:15 on a job, then 10 kW until 17:30 with no job, then off.
    db_session.add_all(power(machine, ago, 10, order.id) for ago in (60, 55, 50))
    db_session.add_all(power(machine, ago, 10) for ago in (45, 40, 35))
    db_session.add(power(machine, 30, 0))
    # A reading followed by a long silence counts for 15 minutes only.
    db_session.add(power(machine, 600, 8))
    await db_session.commit()
    day = NOW.date()
    totals = (await daily_energy(db_session, NOW - timedelta(hours=18), NOW))[day]
    assert round(totals.kwh, 2) == 5 + 2
    assert round(totals.peak_kwh, 2) == 5  # 08:00 is off-peak, 17:00 is peak
    assert round(totals.no_job_kwh, 2) == 2.5 + 2
    assert round(totals.cost, 2) == round(5 * 0.5 + 2 * 0.3, 2)


async def test_energy_chart_api(client, auth_headers, db_session):
    machine = await add_machine(db_session, status="running")
    db_session.add(power(machine, 0, 10))
    await db_session.commit()
    chart = await client.get("/api/dashboard/charts/energy_daily", headers=auth_headers("manager"))
    assert chart.status_code == 200
    assert [series["name"] for series in chart.json()["series"]] == [
        "Peak kWh",
        "Off-peak kWh",
        "With no job running",
    ]
    cost = await client.get("/api/dashboard/charts/energy_cost_daily", headers=auth_headers("store"))
    assert cost.status_code == 403


async def test_machine_overview_leaves_out_power_readings(client, auth_headers, db_session):
    machine = await add_machine(db_session)
    db_session.add(status(machine, 10, "idle"))
    db_session.add_all(power(machine, ago, 2) for ago in range(60, -1, -5))
    await db_session.commit()
    overview = await client.get(f"/api/machines/{machine.id}/overview", headers=auth_headers("planner"))
    assert [event["event_type"] for event in overview.json()["recent_events"]] == ["status"]


# ---------------------------------------------------------------- chat
async def test_chat_energy_summary_hides_cost_from_store(db_session, users, monkeypatch):
    from app.api import chat

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)

    monkeypatch.setattr(chat, "datetime", FixedDateTime)
    await idle_and_on(db_session)
    manager = await read_tool("energy_summary", {"days": 3}, None, users["manager"], None)
    assert manager["alerts_now"] and "peak_rate" in manager["tariff"]
    store = await read_tool("energy_summary", {}, None, users["store"], None)
    assert "peak_rate" not in store["tariff"]
    assert all("cost" not in row for row in store["days"])
    assert all(set(alert) == {"title"} for alert in store["alerts_now"])
    refused = await read_tool("energy_summary", {"days": 99}, None, users["manager"], None)
    assert "error" in refused


# ---------------------------------------------------------------- simulator
def power_events(broker, machine):
    payloads = [json.loads(delivery.body)["payload"] for delivery in broker.published_to("event.machine.raw")]
    return [
        float(payload["value"])
        for payload in payloads
        if payload["machine_id"] == str(machine.id) and payload["kind"] == "power"
    ]


async def test_simulator_sends_power_for_running_idle_and_off(db_session, fake_broker, monkeypatch):
    monkeypatch.setattr(settings, "sim_breakdown_chance_per_hour", 0.0)
    monkeypatch.setattr(settings, "sim_energy_problem_chance_per_hour", 0.0)
    shift = Shift(name="Day", weekday=NOW.weekday(), start_time=time(8), end_time=time(19))
    idle_machine = await add_machine(db_session)
    busy = await add_machine(db_session)
    untracked = Machine(code="NO-KW", name="Bench", machine_type="bench", status="idle")
    order = Order(order_number="SO-SIM", status="IN_PRODUCTION")
    db_session.add_all([shift, untracked, order])
    await db_session.flush()
    db_session.add(
        ScheduleSlot(
            order_id=order.id,
            machine_id=busy.id,
            routing_step=1,
            quantity=10,
            start_at=NOW - timedelta(hours=1),
            end_at=NOW + timedelta(hours=1),
            status="locked",
        )
    )
    await db_session.commit()
    simulation = runtime.MachineSimulation(random.Random(3))
    await simulation.tick(NOW, 20)
    (running,) = power_events(fake_broker, busy)
    (idle,) = power_events(fake_broker, idle_machine)
    assert 19 <= running <= 21 and 1.9 <= idle <= 2.1
    assert power_events(fake_broker, untracked) == []

    # Same state a minute later: nothing new. After the interval: a fresh reading.
    fake_broker.published.clear()
    await simulation.tick(NOW + timedelta(minutes=1), 20)
    assert power_events(fake_broker, idle_machine) == []
    await simulation.tick(NOW + timedelta(seconds=settings.sim_power_interval_seconds + 1), 20)
    assert len(power_events(fake_broker, idle_machine)) == 1

    # After the shift (19:00) an idle machine is switched off.
    fake_broker.published.clear()
    await simulation.tick(NOW + timedelta(hours=1, minutes=5), 20)
    assert power_events(fake_broker, idle_machine) == [0.0]


async def test_simulator_can_leave_a_machine_on_after_the_shift(db_session, fake_broker, monkeypatch):
    monkeypatch.setattr(settings, "sim_breakdown_chance_per_hour", 0.0)
    monkeypatch.setattr(settings, "sim_energy_problem_chance_per_hour", 1.0)  # always left on
    db_session.add(Shift(name="Day", weekday=NOW.weekday(), start_time=time(8), end_time=time(19)))
    machine = await add_machine(db_session)
    await db_session.commit()
    simulation = runtime.MachineSimulation(random.Random(3))
    await simulation.tick(NOW, 20)
    fake_broker.published.clear()
    await simulation.tick(NOW + timedelta(hours=1, minutes=5), 20)
    (reading,) = power_events(fake_broker, machine)
    assert reading > 1  # still on


async def test_sim_energy_off_sends_no_power(db_session, fake_broker, monkeypatch):
    monkeypatch.setattr(settings, "sim_energy", False)
    machine = await add_machine(db_session)
    await db_session.commit()
    await runtime.MachineSimulation(random.Random(3)).tick(NOW, 20)
    assert power_events(fake_broker, machine) == []
