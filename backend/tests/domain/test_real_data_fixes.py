"""Fixes found by replaying real machine data (see tests/realdata)."""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select

from app.agents import maintenance, monitoring
from app.agents.planning import service
from app.agents.planning.confidence import (
    MIN_OBSERVED_JOBS,
    MachineRisk,
    SimJob,
    confidence_for,
    simulate,
)
from app.models import (
    AppSetting,
    AuditLog,
    MachineEvent,
    MaintenanceEvent,
    PlanOption,
    ScheduleSlot,
)
from app.orchestrator import machine_replans
from app.schemas.envelope import Envelope
from tests.domain.test_confidence import RELIABLE, at, office_hours

MONDAY = date(2027, 1, 4)


def test_a_machine_record_replaces_the_general_model():
    machine = uuid4()
    jobs = [SimJob(machine, 1, at(MONDAY, 8), at(MONDAY, 12), True)]
    # A long record (so it is trusted): this machine always takes twice as long as planned.
    slow = MachineRisk(0, 1, samples=[(400.0, 400.0)] * MIN_OBSERVED_JOBS)
    result = simulate(jobs, {machine: slow}, office_hours(), MONDAY, seed=1)
    assert result.chance_on_time == 100  # 8 hours still fit on Monday
    late = simulate(
        [SimJob(machine, 1, at(MONDAY, 8), at(MONDAY, 13), True)],
        {machine: slow},
        office_hours(),
        MONDAY,
        seed=1,
    )
    assert late.chance_on_time < 20 and late.likely_date > MONDAY


def test_other_orders_wait_for_their_own_earlier_step():
    first, second, other = uuid4(), uuid4(), uuid4()
    slow = MachineRisk(0, 1, samples=[(400.0, 800.0)] * MIN_OBSERVED_JOBS)
    # The other order's step 1 runs on a slow machine; its step 2 sits before the target on machine B.
    other_step_1 = SimJob(first, 1, at(MONDAY, 8), at(MONDAY, 10), False, other)
    other_step_2 = SimJob(second, 2, at(MONDAY, 10), at(MONDAY, 12), False, other)
    target = SimJob(second, 1, at(MONDAY, 12), at(MONDAY, 14), True)
    risks = {first: slow, second: RELIABLE}
    alone = simulate([target, other_step_2], risks, office_hours(), MONDAY, seed=2)
    chained = simulate([target, other_step_1, other_step_2], risks, office_hours(), MONDAY, seed=2)
    assert alone.chance_on_time == 100
    assert chained.chance_on_time < 100


async def finished_job(session, machine, order, start, planned_hours, real_hours):
    session.add(
        ScheduleSlot(
            order_id=order.id,
            machine_id=machine.id,
            routing_step=1,
            quantity=10,
            start_at=start,
            end_at=start + timedelta(hours=planned_hours),
            status="done",
        )
    )
    session.add(
        MachineEvent(
            id=uuid4(),
            machine_id=machine.id,
            event_type="count",
            value="10",
            order_id=order.id,
            happened_at=start + timedelta(hours=real_hours),
        )
    )


def past_weekdays(count):
    """The last `count` weekdays before MONDAY, at 08:00."""
    days, day = [], MONDAY
    while len(days) < count:
        day -= timedelta(days=1)
        if day.weekday() < 5:
            days.append(at(day, 8))
    return days


async def test_finished_jobs_teach_the_real_job_length(capacity, make_order, db_session):
    machine = await capacity()
    order = await make_order()
    now = at(MONDAY, 7)
    target = [SimJob(machine.id, 1, at(MONDAY, 8), at(MONDAY, 10), True)]
    unknown = await confidence_for(db_session, target, MONDAY, "x", (), now)
    assert unknown.low_history
    # 40 past jobs, each planned for 1 hour that really took 3 (shift: 08:00-12:00 weekdays).
    for start in past_weekdays(40):
        await finished_job(db_session, machine, order, start, 1, 3)
    await db_session.commit()
    learned = await confidence_for(db_session, target, MONDAY, "x", (), now)
    assert not learned.low_history
    assert unknown.chance_on_time == 100
    assert learned.chance_on_time < unknown.chance_on_time


async def test_promise_follows_the_setting(capacity, make_order, db_session):
    machine = await capacity(cycle_seconds=360)
    history = await make_order()
    for start in past_weekdays(40):
        await finished_job(db_session, machine, history, start, 1, 3)
    db_session.add(AppSetting(key="promise_confidence_percent", value="90"))
    await db_session.commit()
    order = await make_order(quantity=30, due_date=MONDAY + timedelta(days=14))  # 3 planned hours
    result = await service.plan_order(db_session, order.id, MONDAY)
    option = await db_session.get(PlanOption, result.recommended_option_id)
    await service.lock_plan(db_session, order.id, option.id)
    await db_session.commit()
    await db_session.refresh(order)
    assert order.promised_date > option.finish_date


async def raw(machine, kind, value, moment):
    await monitoring.handle(
        Envelope(
            type="event",
            from_agent="simulator",
            action="event.machine.raw",
            payload={"machine_id": str(machine.id), "kind": kind, "value": value, "at": moment.isoformat()},
        )
    )


async def test_short_stops_do_not_replan_and_long_ones_get_an_end(capacity, db_session):
    machine = await capacity()
    start = datetime(2027, 1, 4, 9, 0, tzinfo=UTC)
    await raw(machine, "status", "down", start)
    await maintenance.scan(now=start + timedelta(minutes=2))
    published = select(func.count()).select_from(AuditLog).where(AuditLog.action == "machine_unavailable")
    assert await db_session.scalar(published) == 0
    await maintenance.scan(now=start + timedelta(minutes=20))
    record = await db_session.scalar(select(AuditLog).where(AuditLog.action == "machine_unavailable"))
    assert record.after["to"] == (start + timedelta(hours=1.5)).isoformat()  # default repair time
    # Scanning again while the estimate still holds publishes nothing new.
    await maintenance.scan(now=start + timedelta(minutes=40))
    assert await db_session.scalar(published) == 1


async def test_a_replan_is_dropped_when_the_machine_is_back_first(capacity, db_session):
    machine = await capacity()
    start = datetime.now(UTC) - timedelta(minutes=30)
    db_session.add(
        MaintenanceEvent(
            machine_id=machine.id,
            maintenance_type="breakdown",
            start_at=start,
            end_at=start + timedelta(minutes=20),
            downtime_hours=Decimal("0.33"),
        )
    )
    await db_session.commit()
    message = Envelope(
        type="event",
        from_agent="maintenance",
        action="event.machine.unavailable",
        payload={
            "machine_id": str(machine.id),
            "from": start.isoformat(),
            "to": (start + timedelta(hours=1.5)).isoformat(),
            "reason": "Machine reported down",
        },
    )
    await machine_replans.enqueue(message)
    await machine_replans.advance()
    job = await db_session.scalar(select(AuditLog).where(AuditLog.entity == machine_replans.ENTITY))
    await db_session.refresh(job)
    assert job.action == "skipped"


async def test_counts_after_a_finished_job_belong_to_no_order(capacity, make_order, db_session):
    machine = await capacity()
    first, second = await make_order(), await make_order()
    for order, hour in ((first, 8), (second, 14)):
        db_session.add(
            ScheduleSlot(
                order_id=order.id,
                machine_id=machine.id,
                routing_step=1,
                quantity=10,
                start_at=at(MONDAY, hour),
                end_at=at(MONDAY, hour + 4),
                status="locked",
            )
        )
    await db_session.commit()
    await raw(machine, "count", "4", at(MONDAY, 13))  # job 1 is late: still its count
    await raw(machine, "count", "10", datetime.combine(MONDAY, time(13, 20), tzinfo=UTC))
    await raw(machine, "count", "3", datetime.combine(MONDAY, time(13, 40), tzinfo=UTC))  # between jobs
    owners = list(await db_session.scalars(select(MachineEvent.order_id).order_by(MachineEvent.happened_at)))
    assert owners == [first.id, first.id, None]
