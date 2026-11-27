"""Delivery confidence: run a plan many times with random breakdowns and slower runs.

The solver gives one date that assumes nothing goes wrong. This replays the plan's jobs
RUNS times. In each run, every job:
- starts when its machine is free, and after its own order's previous step,
- takes as long as it really takes on that machine. When a machine has MIN_OBSERVED_JOBS finished
  jobs, a job's extra time is built from that machine's real past jobs: random past jobs are drawn
  until their planned hours cover this job, and their real extra time is added up (a long job lives
  through several short jobs' worth of trouble, a short job through one). That record already holds
  every stop, short or long, and every slow day.
- On machines without that record yet, runs a little slower or faster than planned (PACE_RANGE)
  and can break down. Breakdown rate and repair time come from the machine's breakdown history.

Work only happens inside shift hours, plus the overtime the plan itself booked.
The same plan always gives the same answer (fixed random seed). No AI calls.
"""

import bisect
import math
import random
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Numeric, and_, case, cast, exists, func, select

from app.agents.planning.calendar import Window, calendar, merge
from app.api.settings import effective_settings
from app.core.config import settings
from app.models import Holiday, MachineEvent, MaintenanceEvent, ScheduleSlot, Shift

RUNS = 200
PACE_RANGE = (0.95, 1.15)  # jobs run late more often than early
HISTORY_DAYS = 90
# With little history, assume one breakdown per 80 working hours with a 1.5 hour repair.
# Real history is blended in: (breakdowns + 1) / (working hours + 80).
PRIOR_HOURS = 80.0
DEFAULT_REPAIR_HOURS = 1.5
# Finished jobs a machine needs before its own record replaces the general breakdown model.
MIN_OBSERVED_JOBS = 5
HOUR = 3600


@dataclass
class SimJob:
    machine_id: UUID
    step: int
    start: datetime
    end: datetime
    is_target: bool
    order_id: UUID | None = None  # other orders' steps also wait for their own previous step


@dataclass
class MachineRisk:
    breakdowns_per_hour: float
    repair_hours: float
    # Finished jobs of the last HISTORY_DAYS: (start, planned end, real end).
    observed: list[tuple[datetime, datetime, datetime]] = field(default_factory=list)
    # (planned working hours, real minus planned hours), one per observed job (filled in by prepare).
    samples: list[tuple[float, float]] = field(default_factory=list)


@dataclass
class Confidence:
    chance_on_time: int | None  # percent of runs that ship by the due date
    likely_date: date  # half the runs ship by this date
    safe_date: date  # 9 in 10 runs ship by this date
    runs: int
    low_history: bool = False  # a machine of this order has too few finished jobs to judge it well


@dataclass
class Calendar:
    zone: ZoneInfo
    windows: list[Window]  # sorted working time
    starts: list[datetime]
    qc_buffer_hours: float
    shipping_buffer_days: float


def next_working_time(clock: Calendar, moment: datetime, seconds: float) -> datetime:
    """The time when `seconds` of work started at `moment` is done, counting working time only."""
    index = max(0, bisect.bisect_right(clock.starts, moment) - 1)
    remaining = seconds
    for window_start, window_end in clock.windows[index:]:
        if window_end <= moment:
            continue
        begin = max(moment, window_start)
        available = (window_end - begin).total_seconds()
        if remaining <= available:
            return begin + timedelta(seconds=remaining)
        remaining -= available
        moment = window_end
    return moment + timedelta(seconds=remaining)  # past the calendar: count straight time


def working_seconds(clock: Calendar, start: datetime, end: datetime) -> float:
    """Working time between two moments."""
    index = max(0, bisect.bisect_right(clock.starts, start) - 1)
    total = 0.0
    for window_start, window_end in clock.windows[index:]:
        if window_start >= end:
            break
        total += max(0.0, (min(end, window_end) - max(start, window_start)).total_seconds())
    return total


def ship_date(clock: Calendar, end: datetime) -> date:
    finished = (end + timedelta(hours=clock.qc_buffer_hours)).astimezone(clock.zone).date()
    return finished + timedelta(days=clock.shipping_buffer_days)


def job_hours(job: SimJob, risk: MachineRisk | None, rng: random.Random) -> float:
    planned = (job.end - job.start).total_seconds() / HOUR
    if risk and len(risk.samples) >= MIN_OBSERVED_JOBS:
        # Trust the machine's own record as much as its size allows, the same way the breakdown
        # rate blends in PRIOR_HOURS: with little history one odd job must not decide everything.
        recorded = sum(past_planned for past_planned, _ in risk.samples)
        trust = recorded / (recorded + PRIOR_HOURS)
        left, total = planned, 0.0
        while left > 0:
            past_planned, past_extra = rng.choice(risk.samples)
            piece = min(left, past_planned)
            if rng.random() < trust:
                total += piece + past_extra * piece / past_planned
            else:
                total += general_hours(piece, risk, rng)
            left -= past_planned
        return max(total, 0.0)
    return general_hours(planned, risk, rng)


def general_hours(planned: float, risk: MachineRisk | None, rng: random.Random) -> float:
    """The general model: a pace from PACE_RANGE plus breakdowns at the machine's breakdown rate."""
    work_hours = planned * rng.uniform(*PACE_RANGE)
    if risk and risk.breakdowns_per_hour > 0:
        clock_hours = rng.expovariate(risk.breakdowns_per_hour)
        repairs = 0.0
        while clock_hours < work_hours:
            repairs += rng.expovariate(1 / risk.repair_hours)
            clock_hours += rng.expovariate(risk.breakdowns_per_hour)
        work_hours += repairs
    return work_hours


def one_run(jobs: list[SimJob], risks: dict[UUID, MachineRisk], clock: Calendar, rng: random.Random):
    machine_free: dict[UUID, datetime] = {}
    step_end: dict[object, dict[int, datetime]] = {}
    finish = None
    for job in jobs:
        earliest = max(job.start, machine_free.get(job.machine_id, job.start))
        key = "target" if job.is_target else job.order_id
        if key is not None:
            earlier_steps = [end for step, end in step_end.get(key, {}).items() if step < job.step]
            earliest = max([earliest, *earlier_steps])
        end = next_working_time(clock, earliest, job_hours(job, risks.get(job.machine_id), rng) * HOUR)
        machine_free[job.machine_id] = end
        if key is not None:
            steps = step_end.setdefault(key, {})
            steps[job.step] = max(end, steps.get(job.step, end))
        if job.is_target:
            finish = max(end, finish or end)
    return finish


def run_dates(jobs, risks, clock, seed: int, runs: int = RUNS) -> list[date]:
    """Sorted ship dates of the target over `runs` replays."""
    jobs = sorted(jobs, key=lambda job: (job.start, job.step))
    rng = random.Random(seed)
    return sorted(ship_date(clock, one_run(jobs, risks, clock, rng)) for _ in range(runs))


def date_at(dates: list[date], percent: float) -> date:
    """The date by which `percent` of the runs ship."""
    return dates[min(len(dates), max(1, math.ceil(percent / 100 * len(dates)))) - 1]


def simulate(
    jobs: list[SimJob],
    risks: dict[UUID, MachineRisk],
    clock: Calendar,
    due: date | None,
    seed: int,
    runs: int = RUNS,
) -> Confidence | None:
    if not any(job.is_target for job in jobs):
        return None
    dates = run_dates(jobs, risks, clock, seed, runs)
    return Confidence(
        chance_on_time=round(100 * sum(day <= due for day in dates) / runs) if due else None,
        likely_date=date_at(dates, 50),
        safe_date=date_at(dates, 90),
        runs=runs,
    )


async def machine_risks(session, machine_ids, now: datetime) -> dict[UUID, MachineRisk]:
    since = now - timedelta(days=HISTORY_DAYS)
    hours = dict(
        (
            await session.execute(
                select(
                    ScheduleSlot.machine_id,
                    func.sum(func.extract("epoch", ScheduleSlot.end_at - ScheduleSlot.start_at)) / HOUR,
                )
                .where(
                    ScheduleSlot.machine_id.in_(machine_ids),
                    ScheduleSlot.status.in_(("locked", "done")),
                    ScheduleSlot.start_at >= since,
                    ScheduleSlot.start_at < now,
                )
                .group_by(ScheduleSlot.machine_id)
            )
        ).all()
    )
    breakdowns = {
        machine_id: (count, repair)
        for machine_id, count, repair in (
            await session.execute(
                select(
                    MaintenanceEvent.machine_id,
                    func.count(),
                    func.avg(MaintenanceEvent.downtime_hours),
                )
                .where(
                    MaintenanceEvent.machine_id.in_(machine_ids),
                    MaintenanceEvent.maintenance_type == "breakdown",
                    MaintenanceEvent.start_at >= since,
                )
                .group_by(MaintenanceEvent.machine_id)
            )
        ).all()
    }
    observed = await finished_jobs(session, machine_ids, since, now)
    risks = {}
    for machine_id in machine_ids:
        count, repair = breakdowns.get(machine_id, (0, None))
        worked = float(hours.get(machine_id) or 0)
        risks[machine_id] = MachineRisk(
            breakdowns_per_hour=(count + 1) / (worked + PRIOR_HOURS),
            repair_hours=float(repair) if repair else DEFAULT_REPAIR_HOURS,
            observed=observed.get(machine_id, []),
        )
    return risks


def count_matches(slot=ScheduleSlot):
    # Strictly after the start: a count at the very moment a job starts is the end of the job
    # before it (same order, same machine), not this one.
    return and_(
        MachineEvent.machine_id == slot.machine_id,
        MachineEvent.order_id == slot.order_id,
        MachineEvent.event_type == "count",
        MachineEvent.happened_at > slot.start_at,
    )


async def finished_jobs(session, machine_ids, since: datetime, now: datetime) -> dict:
    """Jobs whose planned end has passed, with the time the machine reported the full quantity.

    A job that reported some parts but not all yet is still running late: it counts as ending now,
    which is the least it took. Jobs without any part counts are skipped (nothing to learn from).
    """
    # CASE keeps the cast away from non-count events, whatever order the database checks things in.
    count_value = case((MachineEvent.event_type == "count", cast(MachineEvent.value, Numeric)), else_=None)
    completed_at = (
        select(func.min(MachineEvent.happened_at))
        .where(count_matches(), count_value >= ScheduleSlot.quantity)
        .correlate(ScheduleSlot)
        .scalar_subquery()
    )
    reported = exists().where(count_matches()).correlate(ScheduleSlot)
    rows = await session.execute(
        select(
            ScheduleSlot.machine_id,
            ScheduleSlot.start_at,
            ScheduleSlot.end_at,
            ScheduleSlot.status,
            completed_at,
        ).where(
            ScheduleSlot.machine_id.in_(machine_ids),
            ScheduleSlot.status.in_(("locked", "done")),
            ScheduleSlot.start_at >= since,
            ScheduleSlot.end_at < now,
            reported,
        )
    )
    found: dict[UUID, list] = {}
    for machine_id, start, end, status, done_at in rows.all():
        if done_at is None and status != "locked":
            continue  # stopped early (cancelled): its length says nothing about the machine
        found.setdefault(machine_id, []).append((start, end, done_at or now))
    return found


def add_samples(risks: dict[UUID, MachineRisk], clock: Calendar) -> None:
    for risk in risks.values():
        risk.samples = []
        for start, planned_end, real_end in risk.observed:
            planned = working_seconds(clock, start, planned_end) / HOUR
            if planned > 0:
                real = working_seconds(clock, start, real_end) / HOUR
                risk.samples.append((planned, real - planned))


async def load_calendar(session, jobs: list[SimJob], now: datetime) -> Calendar:
    zone = ZoneInfo(settings.app_timezone)
    start = min([now, *(job.start for job in jobs)])
    end = max([now, *(job.end for job in jobs)]) + timedelta(days=120)
    shifts = list(await session.scalars(select(Shift)))
    holidays = set(await session.scalars(select(Holiday.holiday_date)))
    regular, _ = calendar(start, end, zone, shifts, holidays)
    # Overtime the plan booked counts as working time too.
    windows = merge(sorted([*regular, *((job.start, job.end) for job in jobs)]))
    config = await effective_settings(session)
    return Calendar(
        zone=zone,
        windows=windows,
        starts=[window[0] for window in windows],
        qc_buffer_hours=config["qc_buffer_hours"],
        shipping_buffer_days=config["shipping_buffer_days"],
    )


async def jobs_ahead(session, target_jobs: list[SimJob], now: datetime, skip_order_ids) -> list[SimJob]:
    """Booked jobs of other orders on the same machines that run before the target finishes.

    Their delays push the target, so they are replayed too, together with those orders' earlier
    steps on other machines (a late earlier step makes their job here start late).
    """
    machine_ids = {job.machine_id for job in target_jobs}
    last_end = max(job.end for job in target_jobs)
    rows = list(
        await session.scalars(
            select(ScheduleSlot).where(
                ScheduleSlot.machine_id.in_(machine_ids),
                ScheduleSlot.status == "locked",
                ScheduleSlot.end_at > now,
                ScheduleSlot.start_at < last_end,
                ScheduleSlot.order_id.not_in(skip_order_ids),
            )
        )
    )
    seen = {row.id for row in rows}
    latest_step = {}
    for row in rows:
        latest_step[row.order_id] = max(row.routing_step, latest_step.get(row.order_id, row.routing_step))
    if latest_step:
        for row in await session.scalars(
            select(ScheduleSlot).where(
                ScheduleSlot.order_id.in_(list(latest_step)),
                ScheduleSlot.status == "locked",
                ScheduleSlot.end_at > now,
            )
        ):
            if row.id not in seen and row.routing_step < latest_step[row.order_id]:
                rows.append(row)
    return [
        SimJob(row.machine_id, row.routing_step, max(row.start_at, now), row.end_at, False, row.order_id)
        for row in rows
        if row.end_at > max(row.start_at, now)
    ]


def as_dict(confidence: Confidence | None) -> dict | None:
    return asdict(confidence) if confidence else None


async def prepare(session, target_jobs: list[SimJob], skip_order_ids, now: datetime):
    """Everything a replay needs: the jobs, each machine's record and the working calendar."""
    jobs = [*target_jobs, *(await jobs_ahead(session, target_jobs, now, list(skip_order_ids)))]
    risks = await machine_risks(session, list({job.machine_id for job in jobs}), now)
    history = [
        SimJob(machine_id, 0, start, planned_end, False)
        for machine_id, risk in risks.items()
        for start, planned_end, _ in risk.observed
    ]
    # The calendar also covers the past jobs, so their real length is measured in working time.
    clock = await load_calendar(session, [*jobs, *history], now)
    add_samples(risks, clock)
    low_history = any(
        len(risks[machine_id].samples) < MIN_OBSERVED_JOBS
        for machine_id in {job.machine_id for job in target_jobs}
    )
    return jobs, risks, clock, low_history


def seed_of(text: str) -> int:
    return int.from_bytes(text.encode()[:16].ljust(16, b"\0"), "big")


async def confidence_for(
    session, target_jobs: list[SimJob], due: date | None, seed_text: str, skip_order_ids=(), now=None
) -> Confidence | None:
    if not target_jobs:
        return None
    now = now or datetime.now(UTC)
    jobs, risks, clock, low_history = await prepare(session, target_jobs, skip_order_ids, now)
    result = simulate(jobs, risks, clock, due, seed_of(seed_text))
    if result:
        result.low_history = low_history
    return result


async def option_jobs(session, option, order, now):
    slots = await session.scalars(
        select(ScheduleSlot).where(
            ScheduleSlot.plan_option_id == option.id, ScheduleSlot.order_id == order.id
        )
    )
    target = [
        SimJob(slot.machine_id, slot.routing_step, slot.start_at, slot.end_at, True, order.id)
        for slot in slots
        if slot.end_at > now
    ]
    # Orders this option moves are replayed from the option's own slots, not their old bookings.
    moved = [UUID(str(item["order_id"])) for item in option.impacted_orders or []]
    return target, [order.id, *moved]


async def confidence_for_option(session, option, order, now=None) -> Confidence | None:
    """Confidence for one plan option of an order, against the customer's due date."""
    now = now or datetime.now(UTC)
    target, skip = await option_jobs(session, option, order, now)
    return await confidence_for(session, target, order.due_date, str(option.id), skip, now)


async def promise_date(session, option, order, now=None) -> date:
    """The full-delivery date to promise the customer for this option.

    Setting promise_confidence_percent: 0 promises the solver's own date (nothing goes wrong).
    For example 50 promises the date half the replays make, 90 the date 9 in 10 make.
    Never earlier than the solver's date.
    """
    percent = (await effective_settings(session))["promise_confidence_percent"]
    if percent <= 0:
        return option.finish_date
    now = now or datetime.now(UTC)
    target, skip = await option_jobs(session, option, order, now)
    if not target:
        return option.finish_date
    jobs, risks, clock, _ = await prepare(session, target, skip, now)
    dates = run_dates(jobs, risks, clock, seed_of(str(option.id)))
    return max(option.finish_date, date_at(dates, min(percent, 100)))
