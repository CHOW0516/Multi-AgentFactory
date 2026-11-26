"""Delivery confidence: run a plan many times with random breakdowns and slower runs.

The solver gives one date that assumes nothing goes wrong. This replays the plan's jobs
RUNS times. In each run, every job:
- starts when its machine is free, and (for the order being checked) after its previous step,
- runs a little slower or faster than planned (PACE_RANGE),
- can break down. Breakdown rate and repair time come from each machine's breakdown history.

Work only happens inside shift hours, plus the overtime the plan itself booked.
The same plan always gives the same answer (fixed random seed). No AI calls.
"""

import bisect
import math
import random
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.agents.planning.calendar import Window, calendar, merge
from app.api.settings import effective_settings
from app.core.config import settings
from app.models import Holiday, MaintenanceEvent, ScheduleSlot, Shift

RUNS = 200
PACE_RANGE = (0.95, 1.15)  # jobs run late more often than early
HISTORY_DAYS = 90
# With little history, assume one breakdown per 80 working hours with a 1.5 hour repair.
# Real history is blended in: (breakdowns + 1) / (working hours + 80).
PRIOR_HOURS = 80.0
DEFAULT_REPAIR_HOURS = 1.5
HOUR = 3600


@dataclass
class SimJob:
    machine_id: UUID
    step: int
    start: datetime
    end: datetime
    is_target: bool


@dataclass
class MachineRisk:
    breakdowns_per_hour: float
    repair_hours: float


@dataclass
class Confidence:
    chance_on_time: int | None  # percent of runs that ship by the due date
    likely_date: date  # half the runs ship by this date
    safe_date: date  # 9 in 10 runs ship by this date
    runs: int


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


def ship_date(clock: Calendar, end: datetime) -> date:
    finished = (end + timedelta(hours=clock.qc_buffer_hours)).astimezone(clock.zone).date()
    return finished + timedelta(days=clock.shipping_buffer_days)


def one_run(jobs: list[SimJob], risks: dict[UUID, MachineRisk], clock: Calendar, rng: random.Random):
    machine_free: dict[UUID, datetime] = {}
    target_step_end: dict[int, datetime] = {}
    finish = None
    for job in jobs:
        earliest = max(job.start, machine_free.get(job.machine_id, job.start))
        if job.is_target:
            earlier_steps = [end for step, end in target_step_end.items() if step < job.step]
            earliest = max([earliest, *earlier_steps])
        work_hours = (job.end - job.start).total_seconds() / HOUR * rng.uniform(*PACE_RANGE)
        risk = risks.get(job.machine_id)
        if risk and risk.breakdowns_per_hour > 0:
            clock_hours = rng.expovariate(risk.breakdowns_per_hour)
            repairs = 0.0
            while clock_hours < work_hours:
                repairs += rng.expovariate(1 / risk.repair_hours)
                clock_hours += rng.expovariate(risk.breakdowns_per_hour)
            work_hours += repairs
        end = next_working_time(clock, earliest, work_hours * HOUR)
        machine_free[job.machine_id] = end
        if job.is_target:
            target_step_end[job.step] = max(end, target_step_end.get(job.step, end))
            finish = max(end, finish or end)
    return finish


def simulate(
    jobs: list[SimJob],
    risks: dict[UUID, MachineRisk],
    clock: Calendar,
    due: date | None,
    seed: int,
    runs: int = RUNS,
) -> Confidence | None:
    jobs = sorted(jobs, key=lambda job: (job.start, job.step))
    if not any(job.is_target for job in jobs):
        return None
    rng = random.Random(seed)
    dates = sorted(ship_date(clock, one_run(jobs, risks, clock, rng)) for _ in range(runs))
    return Confidence(
        chance_on_time=round(100 * sum(day <= due for day in dates) / runs) if due else None,
        likely_date=dates[math.ceil(0.5 * runs) - 1],
        safe_date=dates[math.ceil(0.9 * runs) - 1],
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
    risks = {}
    for machine_id in machine_ids:
        count, repair = breakdowns.get(machine_id, (0, None))
        worked = float(hours.get(machine_id) or 0)
        risks[machine_id] = MachineRisk(
            breakdowns_per_hour=(count + 1) / (worked + PRIOR_HOURS),
            repair_hours=float(repair) if repair else DEFAULT_REPAIR_HOURS,
        )
    return risks


async def load_calendar(session, jobs: list[SimJob], now: datetime) -> Calendar:
    zone = ZoneInfo(settings.app_timezone)
    start = min([now, *(job.start for job in jobs)])
    end = max(job.end for job in jobs) + timedelta(days=120)
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

    Their delays push the target, so they are replayed too.
    """
    machine_ids = {job.machine_id for job in target_jobs}
    last_end = max(job.end for job in target_jobs)
    rows = await session.scalars(
        select(ScheduleSlot).where(
            ScheduleSlot.machine_id.in_(machine_ids),
            ScheduleSlot.status == "locked",
            ScheduleSlot.end_at > now,
            ScheduleSlot.start_at < last_end,
            ScheduleSlot.order_id.not_in(skip_order_ids),
        )
    )
    return [
        SimJob(row.machine_id, row.routing_step, max(row.start_at, now), row.end_at, False)
        for row in rows
        if row.end_at > max(row.start_at, now)
    ]


def as_dict(confidence: Confidence | None) -> dict | None:
    return asdict(confidence) if confidence else None


async def confidence_for(
    session, target_jobs: list[SimJob], due: date | None, seed_text: str, skip_order_ids=(), now=None
) -> Confidence | None:
    if not target_jobs:
        return None
    now = now or datetime.now(UTC)
    jobs = [*target_jobs, *(await jobs_ahead(session, target_jobs, now, list(skip_order_ids)))]
    risks = await machine_risks(session, list({job.machine_id for job in jobs}), now)
    clock = await load_calendar(session, jobs, now)
    seed = int.from_bytes(seed_text.encode()[:16].ljust(16, b"\0"), "big")
    return simulate(jobs, risks, clock, due, seed)


async def confidence_for_option(session, option, order, now=None) -> Confidence | None:
    """Confidence for one plan option of an order, against the customer's due date."""
    now = now or datetime.now(UTC)
    slots = await session.scalars(
        select(ScheduleSlot).where(
            ScheduleSlot.plan_option_id == option.id, ScheduleSlot.order_id == order.id
        )
    )
    target = [
        SimJob(slot.machine_id, slot.routing_step, slot.start_at, slot.end_at, True)
        for slot in slots
        if slot.end_at > now
    ]
    # Orders this option moves are replayed from the option's own slots, not their old bookings.
    moved = [UUID(str(item["order_id"])) for item in option.impacted_orders or []]
    return await confidence_for(session, target, order.due_date, str(option.id), [order.id, *moved], now)
