"""Power readings: energy per day, and idle or abnormal power alerts. Rules only, no AI calls.

A power reading (machine event "power", kW) holds until the next reading, for at most
READING_HOLD. After that the meter is treated as silent, so a gap never counts as use and never
raises an alert.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Float, case, cast, func, select

from app.agents.planning.calendar import in_shift
from app.agents.planning.energy import Tariff
from app.api.settings import effective_settings
from app.core.config import settings
from app.models import Holiday, Machine, MachineEvent, ScheduleSlot, Shift

READING_HOLD = timedelta(minutes=15)
SWITCHED_ON_KW = 0.5  # above this a machine is on; at or below it is off
NORMAL_HISTORY = timedelta(days=7)
NORMAL_MIN_READINGS = 20  # fewer running readings than this: use the machine's running_kw as normal


@dataclass(frozen=True)
class Reading:
    at: datetime
    kilowatts: float
    order_id: UUID | None


@dataclass
class DayEnergy:
    kwh: float = 0.0
    peak_kwh: float = 0.0
    cost: float = 0.0
    no_job_kwh: float = 0.0


async def tariff_for(session) -> Tariff:
    config = await effective_settings(session)
    holidays = set(await session.scalars(select(Holiday.holiday_date)))
    return Tariff.from_config(config, ZoneInfo(settings.app_timezone), holidays)


async def readings(session, machine_ids, start: datetime, end: datetime) -> dict[UUID, list[Reading]]:
    """Power readings per machine from just before start (the one in force at start) to end."""
    rows = await session.execute(
        select(MachineEvent.machine_id, MachineEvent.happened_at, MachineEvent.value, MachineEvent.order_id)
        .where(
            MachineEvent.machine_id.in_(machine_ids),
            MachineEvent.event_type == "power",
            MachineEvent.happened_at >= start - READING_HOLD,
            MachineEvent.happened_at < end,
        )
        .order_by(MachineEvent.machine_id, MachineEvent.happened_at)
    )
    result = defaultdict(list)
    for machine_id, at, value, order_id in rows:
        result[machine_id].append(Reading(at, float(value), order_id))
    return result


def spans(rows: list[Reading], start: datetime, end: datetime):
    """(from, to, reading) for the time each reading was in force, clipped to start..end."""
    for index, reading in enumerate(rows):
        following = rows[index + 1].at if index + 1 < len(rows) else end
        left, right = max(reading.at, start), min(following, reading.at + READING_HOLD, end)
        if left < right:
            yield left, right, reading


def kwh(rows: list[Reading], start: datetime, end: datetime) -> float:
    return sum(
        reading.kilowatts * (right - left).total_seconds() / 3600
        for left, right, reading in spans(rows, start, end)
    )


async def daily_energy(session, start: datetime, end: datetime) -> dict[date, DayEnergy]:
    """kWh, peak kWh, cost and kWh with no job running, per local day."""
    tariff = await tariff_for(session)
    machines = list(await session.scalars(select(Machine.id)))
    days: dict[date, DayEnergy] = defaultdict(DayEnergy)
    peak_rate, offpeak_rate = float(tariff.peak_rate), float(tariff.offpeak_rate)
    for rows in (await readings(session, machines, start, end)).values():
        for span_left, span_right, reading in spans(rows, start, end):
            for left, right in split_at_midnight(span_left, span_right, tariff.zone):
                add_span(days, left, right, reading, tariff, peak_rate, offpeak_rate)
    return dict(days)


def split_at_midnight(left: datetime, right: datetime, zone) -> list[tuple[datetime, datetime]]:
    """A span that crosses local midnight is cut in two, so each part counts on its own day."""
    pieces = []
    while left < right:
        next_midnight = datetime.combine(left.astimezone(zone).date() + timedelta(days=1), time.min, zone)
        piece_end = min(right, next_midnight.astimezone(left.tzinfo))
        pieces.append((left, piece_end))
        left = piece_end
    return pieces


def add_span(days, left, right, reading, tariff, peak_rate, offpeak_rate) -> None:
    hours = (right - left).total_seconds() / 3600
    peak_hours = tariff.peak_seconds(left, right) / 3600
    day = days[left.astimezone(tariff.zone).date()]
    day.kwh += reading.kilowatts * hours
    day.peak_kwh += reading.kilowatts * peak_hours
    day.cost += reading.kilowatts * (peak_hours * peak_rate + (hours - peak_hours) * offpeak_rate)
    if reading.order_id is None:
        day.no_job_kwh += reading.kilowatts * hours


async def normal_running_kw(session, machine: Machine, now: datetime) -> float:
    """The median of the machine's running readings over the last week, or its running_kw."""
    # CASE keeps the cast away from status and count values, whatever order the database checks things in.
    running = case((MachineEvent.event_type == "power", cast(MachineEvent.value, Float)), else_=None)
    median, count = (
        await session.execute(
            select(func.percentile_cont(0.5).within_group(running), func.count()).where(
                MachineEvent.machine_id == machine.id,
                MachineEvent.event_type == "power",
                MachineEvent.happened_at >= now - NORMAL_HISTORY,
                running >= float(machine.running_kw) * 0.5,
            )
        )
    ).one()
    return float(median) if count >= NORMAL_MIN_READINGS else float(machine.running_kw)


def continuous(rows: list[Reading]) -> bool:
    return all(later.at - earlier.at <= READING_HOLD for earlier, later in zip(rows, rows[1:], strict=False))


def money(value: float) -> str:
    return f"{value:.2f} {settings.currency}"


async def energy_alerts(session, now: datetime) -> list[dict]:
    """Attention items: machines idle but switched on, and machines drawing much more than normal."""
    config = await effective_settings(session)
    tariff = await tariff_for(session)
    if not tariff.enabled:
        return []
    zone = tariff.zone
    shifts = list(await session.scalars(select(Shift)))
    working = in_shift(now, zone, shifts, set(tariff.holidays))
    idle_after = timedelta(minutes=config["energy_idle_alert_minutes"])
    warmup = timedelta(minutes=config["energy_warmup_minutes"])
    abnormal_for = timedelta(minutes=config["energy_abnormal_minutes"])
    abnormal_factor = 1 + config["energy_abnormal_percent"] / 100
    machines = list(
        await session.scalars(select(Machine).where(Machine.running_kw.is_not(None)).order_by(Machine.code))
    )
    history = await readings(session, [machine.id for machine in machines], now - timedelta(hours=24), now)
    items = []
    for machine in machines:
        rows = history.get(machine.id, [])
        if not rows or now - rows[-1].at > READING_HOLD:
            continue  # no recent reading: the meter is silent, so say nothing
        latest = rows[-1]
        if machine.status == "idle" and latest.kilowatts > SWITCHED_ON_KW:
            item = await idle_alert(session, machine, rows, now, idle_after, warmup, working, tariff)
            if item:
                items.append(item)
        elif machine.status == "running":
            normal = await normal_running_kw(session, machine, now)
            if normal <= 0:
                continue  # no usable normal power (running_kw 0), so "percent above normal" means nothing
            limit = normal * abnormal_factor
            window = [reading for reading in rows if reading.at > now - abnormal_for]
            anchor = [reading for reading in rows if reading.at <= now - abnormal_for][-1:]
            # The reading in force at the window start must exist, and no gap in the window may be
            # longer than READING_HOLD, so the whole window was really measured.
            covered = (
                anchor and now - abnormal_for - anchor[0].at <= READING_HOLD and continuous(anchor + window)
            )
            if covered and all(reading.kilowatts > limit for reading in anchor + window):
                percent = round(100 * (latest.kilowatts / normal - 1))
                items.append(
                    dict(
                        severity="medium",
                        kind="energy_abnormal",
                        title=f"{machine.code} uses {percent}% more power than normal",
                        detail=(
                            f"{latest.kilowatts:.1f} kW for at least {int(abnormal_for.total_seconds() // 60)} min "
                            f"while running; normal is {normal:.1f} kW. This can be an early sign of wear "
                            "or a fault. Ask maintenance to check it."
                        ),
                        link="/",
                        action="Open floor",
                    )
                )
    return items


async def idle_alert(session, machine, rows, now, idle_after, warmup, working, tariff) -> dict | None:
    on_since = rows[-1].at
    for reading in reversed(rows):
        if reading.kilowatts <= SWITCHED_ON_KW or on_since - reading.at > READING_HOLD:
            break  # switched off, or a meter gap: count only the time we really saw it on
        on_since = reading.at
    idle_since = await session.scalar(
        select(func.max(MachineEvent.happened_at)).where(
            MachineEvent.machine_id == machine.id,
            MachineEvent.event_type == "status",
            MachineEvent.value == "idle",
        )
    )
    since = max(on_since, idle_since or on_since)
    if now - since < idle_after:
        return None
    next_start = await session.scalar(
        select(func.min(ScheduleSlot.start_at)).where(
            ScheduleSlot.machine_id == machine.id,
            ScheduleSlot.status == "locked",
            ScheduleSlot.start_at > now,
        )
    )
    if next_start is not None and next_start - now <= warmup:
        return None  # warming up for the next job is normal
    used = kwh(rows, since, now)
    peak = sum(
        reading.kilowatts * tariff.peak_seconds(left, right) / 3600
        for left, right, reading in spans(rows, since, now)
    )
    cost = peak * float(tariff.peak_rate) + (used - peak) * float(tariff.offpeak_rate)
    minutes = int((now - since).total_seconds() // 60)
    when = "outside shift hours" if not working else "with no job running"
    upcoming = (
        f"Next job at {next_start.astimezone(tariff.zone):%H:%M %d %b}."
        if next_start
        else "No job is planned on it."
    )
    return dict(
        severity="medium",
        kind="energy_idle",
        title=f"{machine.code} is switched on {when}",
        detail=(
            f"On and idle for {minutes} min, about {used:.1f} kWh ({money(cost)}) so far. "
            f"{upcoming} Switch it off if it is not needed."
        ),
        link="/",
        action="Open floor",
    )
