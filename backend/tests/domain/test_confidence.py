from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.agents.planning import service
from app.agents.planning.confidence import (
    Calendar,
    MachineRisk,
    SimJob,
    confidence_for_option,
    machine_risks,
    next_working_time,
    simulate,
)
from app.models import MaintenanceEvent, PlanOption

MONDAY = date(2027, 1, 4)
UTC_ZONE = ZoneInfo("UTC")


def at(day, hour):
    return datetime.combine(day, time(hour), tzinfo=UTC)


def office_hours(days=30):
    """Working time 08:00 to 16:00 every day, no buffers."""
    windows = [
        (at(MONDAY + timedelta(days=offset), 8), at(MONDAY + timedelta(days=offset), 16))
        for offset in range(days)
    ]
    return Calendar(UTC_ZONE, windows, [window[0] for window in windows], 0, 0)


RELIABLE = MachineRisk(breakdowns_per_hour=0, repair_hours=1)


def test_work_only_counts_inside_working_time():
    clock = office_hours()
    # 2 hours left on Monday, then 3 more hours on Tuesday.
    assert next_working_time(clock, at(MONDAY, 14), 5 * 3600) == at(MONDAY + timedelta(days=1), 11)
    # Starting at night waits for the next shift.
    assert next_working_time(clock, at(MONDAY, 20), 3600) == at(MONDAY + timedelta(days=1), 9)


def test_plenty_of_slack_is_always_on_time():
    machine = uuid4()
    jobs = [SimJob(machine, 1, at(MONDAY, 8), at(MONDAY, 10), True)]
    result = simulate(jobs, {machine: RELIABLE}, office_hours(), MONDAY + timedelta(days=5), seed=1)
    assert result.chance_on_time == 100 and result.likely_date == result.safe_date == MONDAY


def test_breakdowns_lower_the_chance_and_push_the_safe_date():
    machine = uuid4()
    # A full day of work, due the same day: only on time when nothing goes wrong and the pace is good.
    jobs = [SimJob(machine, 1, at(MONDAY, 8), at(MONDAY, 15), True)]
    clock = office_hours()
    reliable = simulate(jobs, {machine: RELIABLE}, clock, MONDAY, seed=7)
    fragile = simulate(
        jobs, {machine: MachineRisk(breakdowns_per_hour=0.3, repair_hours=3)}, clock, MONDAY, seed=7
    )
    assert fragile.chance_on_time < reliable.chance_on_time
    assert fragile.safe_date > MONDAY
    assert fragile.likely_date <= fragile.safe_date


def test_a_late_job_ahead_on_the_same_machine_pushes_the_order():
    machine = uuid4()
    target = SimJob(machine, 1, at(MONDAY, 13), at(MONDAY, 15), True)
    ahead = SimJob(machine, 1, at(MONDAY, 8), at(MONDAY, 13), False)
    risks = {machine: MachineRisk(breakdowns_per_hour=0.5, repair_hours=2)}
    alone = simulate([target], risks, office_hours(), MONDAY, seed=3)
    queued = simulate([target, ahead], risks, office_hours(), MONDAY, seed=3)
    assert queued.chance_on_time < alone.chance_on_time


def test_steps_wait_for_the_previous_step():
    first, second = uuid4(), uuid4()
    jobs = [
        SimJob(first, 1, at(MONDAY, 8), at(MONDAY, 15), True),
        SimJob(second, 2, at(MONDAY, 15), at(MONDAY, 16), True),
    ]
    risks = {first: MachineRisk(0.5, 4), second: RELIABLE}
    result = simulate(jobs, risks, office_hours(), MONDAY, seed=5)
    # Step 2 runs on a reliable machine but waits for the fragile step 1.
    assert result.chance_on_time < 100


def test_same_plan_gives_the_same_answer():
    machine = uuid4()
    jobs = [SimJob(machine, 1, at(MONDAY, 8), at(MONDAY, 15), True)]
    risks = {machine: MachineRisk(0.2, 2)}
    assert simulate(jobs, risks, office_hours(), MONDAY, seed=9) == simulate(
        jobs, risks, office_hours(), MONDAY, seed=9
    )


async def test_breakdown_history_raises_the_risk(capacity, db_session):
    machine = await capacity()
    calm = await machine_risks(db_session, [machine.id], at(MONDAY, 7))
    for day in range(5):
        db_session.add(
            MaintenanceEvent(
                machine_id=machine.id,
                maintenance_type="breakdown",
                start_at=at(MONDAY, 7) - timedelta(days=day + 1),
                end_at=at(MONDAY, 9) - timedelta(days=day + 1),
                downtime_hours=2,
            )
        )
    await db_session.commit()
    broken = await machine_risks(db_session, [machine.id], at(MONDAY, 7))
    assert broken[machine.id].breakdowns_per_hour > calm[machine.id].breakdowns_per_hour
    assert broken[machine.id].repair_hours == 2


async def test_plan_options_get_a_confidence(capacity, make_order, db_session):
    await capacity(cycle_seconds=60)
    order = await make_order(due_date=MONDAY + timedelta(days=7))
    result = await service.plan_order(db_session, order.id, MONDAY)
    option = await db_session.scalar(select(PlanOption).where(PlanOption.id == result.recommended_option_id))
    confidence = await confidence_for_option(db_session, option, order, now=at(MONDAY, 7))
    assert confidence.chance_on_time == 100
    assert confidence.likely_date >= option.finish_date
