"""Replay real machine behaviour against the planner, delivery confidence and breakdown handling.

Data: "Industrial Production Time-Series Dataset from a Beverage Bottling Line",
David, Monson, Soares Junior, Zenodo 2026, doi:10.5281/zenodo.18146866, CC BY 4.0.
One real filling machine, July 2022 to February 2023: every stop (start, end) and daily output.

The data is TEST INPUT ONLY. Nothing here changes or tunes app code.
Skipped unless REALDATA_DIR points at the CSV sheets exported from production_raw.xlsx
(download it from the Zenodo record, then: python tests/realdata/xlsx_to_csv.py production_raw.xlsx <dir>).
Run (inside the backend container): REALDATA_DIR=/data/realdata pytest tests/realdata -s
"""

import csv
import json
import os
import random
import statistics
import time as clock_time
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from app.agents import maintenance, monitoring
from app.agents.planning import service
from app.agents.planning.confidence import (
    SimJob,
    confidence_for,
    confidence_for_option,
    load_calendar,
    next_working_time,
    ship_date,
)
from app.models import (
    AppSetting,
    AuditLog,
    Machine,
    MachineEvent,
    MaintenanceEvent,
    Order,
    OrderLine,
    Part,
    PlanOption,
    Routing,
    ScheduleSlot,
    Shift,
)
from app.orchestrator import machine_replans
from app.orchestrator.outbox import drain_events
from app.schemas.envelope import Envelope

DATA = os.environ.get("REALDATA_DIR")
OUT = Path(os.environ.get("REALDATA_OUT", "/tmp/realdata_results.json"))
pytestmark = pytest.mark.skipif(not DATA, reason="REALDATA_DIR not set")

EXCEL_EPOCH = date(1899, 12, 30)
NOW = datetime(2027, 1, 4, 7, 0, tzinfo=UTC)  # same frozen clock as the planning_clock fixture
ORDERS = int(os.environ.get("REALDATA_ORDERS", "40"))
ROTATIONS = int(os.environ.get("REALDATA_ROTATIONS", "8"))
SCRAP = 0.066  # UCI SECOM fail rate (104 of 1,567), used only as a number

# Same machines and shifts as the demo seed.
MACHINES = [
    ("LATHE-01", "cnc_lathe"),
    ("LATHE-02", "cnc_lathe"),
    ("MILL-01", "cnc_mill"),
    ("MILL-02", "cnc_mill"),
    ("LASER-01", "laser_cutter"),
    ("BRAKE-01", "press_brake"),
    ("QC-01", "qc_station"),
    ("PACK-01", "packing"),
]
PRODUCTION = [code for code, kind in MACHINES if kind not in ("qc_station", "packing")]

RESULTS: dict = {}


def save(key, value):
    RESULTS[key] = value
    OUT.write_text(json.dumps(RESULTS, indent=2, default=str))
    print(f"\n=== {key} ===\n{json.dumps(value, indent=2, default=str)}")


# ---------------------------------------------------------------- the real data
@dataclass
class Stream:
    """The machine's monitored time laid end to end, in hours. Stops and daily pace sit on it."""

    stops: list[tuple[float, float]]  # (start offset, length) in hours
    paces: list[tuple[float, float]]  # (day start offset, time multiplier: >1 means slower than usual)
    total: float


def rows(name):
    with open(Path(DATA) / f"{name}.csv", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_stream() -> Stream:
    days = sorted(rows("daily_operation_summary"), key=lambda row: float(row["date"]))
    stops_by_day: dict[str, list] = {}
    for row in rows("downtime_event_log"):
        stops_by_day.setdefault(row["date"], []).append(row)
    rates = {}
    for day in days:
        if float(day["operation_time_dec"]) > 0.5:
            rates.setdefault(day["product_type_l"], []).append(
                int(day["production_units"]) / float(day["operation_time_dec"])
            )
    typical = {kind: statistics.median(values) for kind, values in rates.items()}
    stops, paces, base = [], [], 0.0
    for day in days:
        start, length = float(day["production_start_time"]), float(day["monitored_time_dec"])
        operating = float(day["operation_time_dec"])
        pace = 1.0
        if operating > 0.5:
            pace = typical[day["product_type_l"]] / (int(day["production_units"]) / operating)
        paces.append((base, pace))
        for stop in sorted(
            stops_by_day.get(day["date"], []), key=lambda row: float(row["downtime_start_time"])
        ):
            offset = (float(stop["downtime_start_time"]) - start) * 24
            stop_hours = float(stop["downtime_time"]) * 24
            if 0 <= offset < length:
                stops.append((base + offset, min(stop_hours, length - offset)))
        base += length
    return Stream(stops, paces, base)


def window(stream: Stream, start: float, length: float) -> list[tuple[float, float]]:
    """Stops inside [start, start + length), wrapping round the end of the data."""
    found = []
    for lap in (0, 1):
        for offset, hours in stream.stops:
            at = offset + lap * stream.total
            if start <= at < start + length:
                found.append((at - start, hours))
    return found


class Replay:
    """Runs jobs on one machine through the real stops and paces, from a starting point in the data."""

    def __init__(self, stream: Stream, start: float, min_stop_minutes: float = 0, use_pace: bool = True):
        stops = [(offset, hours) for offset, hours in stream.stops if hours * 60 >= min_stop_minutes]
        self.stream = Stream(stops, stream.paces, stream.total)
        self.position, self.use_pace = start, use_pace

    def pace(self) -> float:
        if not self.use_pace:
            return 1.0
        at = self.position % self.stream.total
        pace = 1.0
        for offset, value in self.stream.paces:
            if offset <= at:
                pace = value
        return pace

    def run(self, work_hours: float) -> float:
        """Clock hours needed for `work_hours` of planned work, including real stops."""
        remaining, elapsed = work_hours * self.pace(), 0.0
        while True:
            at = self.position % self.stream.total
            lap = self.position - at
            upcoming = [(offset, hours) for offset, hours in self.stream.stops if offset >= at]
            offset, hours = (
                upcoming[0]
                if upcoming
                else (self.stream.stops[0][0] + self.stream.total, self.stream.stops[0][1])
            )
            gap = offset - at
            if remaining <= gap:
                self.position += remaining
                return elapsed + remaining
            elapsed += gap + hours
            remaining -= gap
            self.position = lap + offset + hours


@pytest.fixture(scope="module")
def stream():
    return load_stream()


def test_dataset_summary(stream):
    lengths = sorted(hours * 60 for _, hours in stream.stops)
    paces = sorted(pace for _, pace in stream.paces)
    save(
        "dataset",
        {
            "monitored_hours": round(stream.total, 1),
            "stops": len(lengths),
            "stop_minutes_median": round(statistics.median(lengths), 1),
            "stop_minutes_p90": round(lengths[int(0.9 * len(lengths))], 1),
            "stop_minutes_max": round(lengths[-1], 1),
            "downtime_share": round(sum(lengths) / 60 / stream.total, 3),
            "stops_15min_plus": sum(length >= 15 for length in lengths),
            "daily_pace_multiplier_p10_p50_p90": [
                round(paces[int(q * len(paces))], 2) for q in (0.1, 0.5, 0.9)
            ],
        },
    )


# ---------------------------------------------------------------- factory set-up
async def build_factory(session, catalog):
    machines = {}
    for code, kind in MACHINES:
        machine = Machine(code=code, name=code, machine_type=kind, status="idle")
        session.add(machine)
        machines[code] = machine
    for weekday in range(5):
        session.add(Shift(name="Day", weekday=weekday, start_time=time(8), end_time=time(17)))
        session.add(Shift(name="Evening", weekday=weekday, start_time=time(17), end_time=time(23)))
    session.add(Shift(name="Saturday", weekday=5, start_time=time(8), end_time=time(13)))
    setting = await session.scalar(
        select(AppSetting).where(AppSetting.key == "planning_solver_time_limit_seconds")
    )
    setting.value = "2"
    randomizer = random.Random(11)
    parts = []
    for index in range(12):
        part = Part(part_number=f"RD-{index:02d}", revision="A", customer_id=catalog.customer.id)
        session.add(part)
        await session.flush()
        if index % 3 == 2:
            steps = [
                ("laser_cutter", 30, randomizer.randint(20, 60)),
                ("press_brake", 20, randomizer.randint(20, 60)),
            ]
        else:
            steps = [("cnc_lathe", 45, randomizer.randint(60, 240))]
            if randomizer.random() < 0.6:
                steps.append(("cnc_mill", 60, randomizer.randint(90, 300)))
        steps += [("qc_station", 10, randomizer.randint(15, 45)), ("packing", 5, randomizer.randint(5, 15))]
        for number, (kind, setup, cycle) in enumerate(steps, start=1):
            session.add(
                Routing(
                    part_id=part.id,
                    step_number=number * 10,
                    machine_type=kind,
                    setup_minutes=setup,
                    cycle_seconds_per_part=Decimal(cycle),
                )
            )
        parts.append(part)
    history_order = Order(order_number="SO-HISTORY", customer_id=catalog.customer.id, status="COMPLETED")
    session.add(history_order)
    await session.commit()
    return machines, parts, history_order


async def new_order(session, catalog, part, quantity, due):
    order = Order(
        order_number=f"SO-RD-{uuid4().hex[:10]}",
        customer_id=catalog.customer.id,
        status="VERIFIED",
        due_date=due,
        priority=5,
    )
    session.add(order)
    await session.flush()
    session.add(
        OrderLine(
            order_id=order.id,
            line_number=1,
            part_id=part.id,
            part_number_text=part.part_number,
            revision_text="A",
            quantity=Decimal(quantity),
            unit_price=Decimal("20"),
        )
    )
    await session.commit()
    return order


async def write_history(
    session, machines, history_order, stream, rotation, threshold_minutes, min_stop=0, use_pace=True
):
    """The first half of each machine's slice becomes its last-90-days history.

    Only stops at least `threshold_minutes` long are logged as breakdowns, the way a shop floor
    usually logs them. Shorter stops are not logged anywhere.
    """
    await session.execute(delete(MaintenanceEvent))
    await session.execute(delete(MachineEvent).where(MachineEvent.order_id == history_order.id))
    await session.execute(delete(ScheduleSlot).where(ScheduleSlot.order_id == history_order.id))
    half = stream.total / 2
    begin = NOW - timedelta(days=80)
    clock = await load_calendar(session, [], begin)
    for index, code in enumerate(PRODUCTION):
        machine = machines[code]
        start = (rotation * stream.total / ROTATIONS + index * stream.total / len(PRODUCTION)) % stream.total
        # Past jobs run through the same real data, each reporting its full count when really done.
        replay, used, moment = Replay(stream, start, min_stop, use_pace), 0.0, begin
        lengths = random.Random(rotation * 100 + index)
        while used < half:
            planned = lengths.uniform(2, 8)
            real = replay.run(planned)
            used += real
            planned_end = next_working_time(clock, moment, planned * 3600)
            real_end = next_working_time(clock, moment, real * 3600)
            if real_end >= NOW:
                break
            session.add(
                ScheduleSlot(
                    order_id=history_order.id,
                    machine_id=machine.id,
                    routing_step=10,
                    quantity=100,
                    start_at=moment,
                    end_at=planned_end,
                    status="done",
                )
            )
            session.add(
                MachineEvent(
                    id=uuid4(),
                    machine_id=machine.id,
                    event_type="count",
                    value="100",
                    order_id=history_order.id,
                    happened_at=real_end,
                )
            )
            moment = real_end
        for offset, hours in window(stream, start, half):
            if hours * 60 >= threshold_minutes:
                at = begin + timedelta(hours=offset)
                session.add(
                    MaintenanceEvent(
                        machine_id=machine.id,
                        maintenance_type="breakdown",
                        start_at=at,
                        end_at=at + timedelta(hours=hours),
                        downtime_hours=Decimal(str(round(hours, 2))),
                    )
                )
    await session.commit()


def reality_start(stream, rotation, index):
    return (
        rotation * stream.total / ROTATIONS + index * stream.total / len(PRODUCTION) + stream.total / 2
    ) % stream.total


async def replay_reality(
    session, machines, stream, rotation, jobs_by_order, scrap=0.0, min_stop=0, use_pace=True
):
    """What really happens: every booked job, in planned order, through the real stops and paces."""
    replays = {
        machines[code].id: Replay(stream, reality_start(stream, rotation, index), min_stop, use_pace)
        for index, code in enumerate(PRODUCTION)
    }
    every = sorted(
        ((order_id, job) for order_id, jobs in jobs_by_order.items() for job in jobs),
        key=lambda item: (item[1].start, item[1].step),
    )
    clock = await load_calendar(session, [job for _, job in every], NOW)
    machine_free, step_end, finish = {}, {}, {}
    for order_id, job in every:
        earliest = max(job.start, machine_free.get(job.machine_id, job.start))
        earlier = [end for step, end in step_end.get(order_id, {}).items() if step < job.step]
        earliest = max([earliest, *earlier])
        planned = (job.end - job.start).total_seconds() / 3600
        replay = replays.get(job.machine_id)
        if replay:
            hours = replay.run(planned / (1 - scrap))
        else:
            hours = planned
        end = next_working_time(clock, earliest, hours * 3600)
        machine_free[job.machine_id] = end
        step_end.setdefault(order_id, {})[job.step] = max(end, step_end.get(order_id, {}).get(job.step, end))
        finish[order_id] = max(end, finish.get(order_id, end))
    return {order_id: ship_date(clock, end) for order_id, end in finish.items()}


async def booked_jobs(session, order_ids):
    slots = await session.scalars(
        select(ScheduleSlot).where(ScheduleSlot.order_id.in_(order_ids), ScheduleSlot.status == "locked")
    )
    jobs: dict = {}
    for slot in slots:
        jobs.setdefault(slot.order_id, []).append(
            SimJob(slot.machine_id, slot.routing_step, slot.start_at, slot.end_at, True)
        )
    return jobs


def calibration(records):
    buckets = {"0-49": [], "50-79": [], "80-94": [], "95-100": []}
    for record in records:
        chance = record["chance"]
        key = "0-49" if chance < 50 else "50-79" if chance < 80 else "80-94" if chance < 95 else "95-100"
        buckets[key].append(record)
    errors = sorted((record["actual"] - record["likely"]).days for record in records)
    return {
        "cases": len(records),
        "said_on_time_avg_pct": round(statistics.mean(record["chance"] for record in records), 1),
        "really_on_time_pct": round(
            100 * statistics.mean(record["actual"] <= record["due"] for record in records), 1
        ),
        "brier_score": round(
            statistics.mean(
                (record["chance"] / 100 - (record["actual"] <= record["due"])) ** 2 for record in records
            ),
            3,
        ),
        "later_than_safe_date_pct (should be ~10)": round(
            100 * statistics.mean(record["actual"] > record["safe"] for record in records), 1
        ),
        "later_than_likely_date_pct (should be ~50)": round(
            100 * statistics.mean(record["actual"] > record["likely"] for record in records), 1
        ),
        "actual_minus_likely_days_p10_p50_p90": [errors[int(q * len(errors))] for q in (0.1, 0.5, 0.9)],
        "buckets": {
            key: {
                "cases": len(items),
                "said_avg": round(statistics.mean(item["chance"] for item in items), 1) if items else None,
                "really_on_time_pct": round(
                    100 * statistics.mean(item["actual"] <= item["due"] for item in items), 1
                )
                if items
                else None,
            }
            for key, items in buckets.items()
        },
    }


# ---------------------------------------------------------------- test A: is the confidence honest?
async def test_confidence_against_real_breakdowns(db_session, catalog, planning_clock, stream):
    session = db_session
    machines, parts, history_order = await build_factory(session, catalog)
    await write_history(session, machines, history_order, stream, 0, 15)
    randomizer = random.Random(5)
    orders, at_promise, started = [], {}, clock_time.perf_counter()
    plan_seconds = []
    for _ in range(ORDERS):
        part = randomizer.choice(parts)
        due = NOW.date() + timedelta(days=randomizer.randint(4, 25))
        order = await new_order(session, catalog, part, randomizer.choice([50, 100, 200, 300, 400]), due)
        tick = clock_time.perf_counter()
        result = await service.plan_order(session, order.id, NOW.date())
        plan_seconds.append(clock_time.perf_counter() - tick)
        if result.recommended_option_id is None:
            continue
        option = await session.get(PlanOption, result.recommended_option_id)
        confidence = await confidence_for_option(session, option, order, now=NOW)
        await service.lock_plan(session, order.id, option.id)
        await session.commit()
        orders.append(order)
        at_promise[order.id] = {
            "chance": confidence.chance_on_time,
            "kind": option.option_type,
            "promised": option.finish_date,
            "likely": confidence.likely_date,
            "safe": confidence.safe_date,
            "low_history": confidence.low_history,
        }
    planning = {
        "orders_planned": len(orders),
        "seconds_total": round(clock_time.perf_counter() - started, 1),
        "plan_order_seconds_first_last": [round(plan_seconds[0], 2), round(plan_seconds[-1], 2)],
        "option_kinds": dict(
            sorted(
                {
                    kind: sum(v["kind"] == kind for v in at_promise.values())
                    for kind in {v["kind"] for v in at_promise.values()}
                }.items()
            )
        ),
    }
    save("planning_run", planning)

    jobs_by_order = await booked_jobs(session, [order.id for order in orders])
    summary, staleness = {}, None
    for threshold in (5, 15, 60):
        records, promise_kept, likely_kept, safe_kept = [], [], [], []
        for rotation in range(ROTATIONS):
            await write_history(session, machines, history_order, stream, rotation, threshold)
            actual = await replay_reality(session, machines, stream, rotation, jobs_by_order)
            for order in orders:
                confidence = await confidence_for(
                    session,
                    jobs_by_order[order.id],
                    order.due_date,
                    f"{order.id}-{rotation}",
                    [order.id],
                    NOW,
                )
                records.append(
                    {
                        "chance": confidence.chance_on_time,
                        "likely": confidence.likely_date,
                        "safe": confidence.safe_date,
                        "actual": actual[order.id],
                        "due": order.due_date,
                    }
                )
                promise_kept.append(actual[order.id] <= at_promise[order.id]["promised"])
                likely_kept.append(actual[order.id] <= at_promise[order.id]["likely"])
                safe_kept.append(actual[order.id] <= at_promise[order.id]["safe"])
                if threshold == 15 and rotation == 0:
                    staleness = staleness or []
                    staleness.append(at_promise[order.id]["chance"] - confidence.chance_on_time)
        summary[f"log_stops_from_{threshold}min"] = calibration(records)
        summary[f"log_stops_from_{threshold}min"]["promised_date_kept_pct"] = {
            "solver_date (setting 0)": round(100 * statistics.mean(promise_kept), 1),
            "likely_date (setting 50)": round(100 * statistics.mean(likely_kept), 1),
            "safe_date (setting 90)": round(100 * statistics.mean(safe_kept), 1),
        }
    save("confidence_honesty", summary)
    save(
        "confidence_goes_stale",
        {
            "orders": len(staleness),
            "chance_dropped_after_later_orders_were_booked_avg_points": round(statistics.mean(staleness), 1),
            "orders_whose_chance_dropped_10_points_or_more": sum(drop >= 10 for drop in staleness),
        },
    )

    # Fairness check: a shop's routing times may already include short stops. So also compare against
    # realities that hold only the stops the system can learn about (logged, 15 min and longer).
    variants = {}
    for name, min_stop, use_pace in (
        ("all_real_stops_and_pace", 0, True),
        ("only_logged_stops_plus_real_pace", 15, True),
        ("only_logged_stops_no_pace_swings", 15, False),
    ):
        records = []
        for rotation in range(ROTATIONS):
            await write_history(session, machines, history_order, stream, rotation, 15, min_stop, use_pace)
            actual = await replay_reality(
                session, machines, stream, rotation, jobs_by_order, min_stop=min_stop, use_pace=use_pace
            )
            for order in orders:
                confidence = await confidence_for(
                    session,
                    jobs_by_order[order.id],
                    order.due_date,
                    f"{order.id}-{rotation}",
                    [order.id],
                    NOW,
                )
                records.append(
                    {
                        "chance": confidence.chance_on_time,
                        "likely": confidence.likely_date,
                        "safe": confidence.safe_date,
                        "actual": actual[order.id],
                        "due": order.due_date,
                    }
                )
        variants[name] = calibration(records)
    save("confidence_vs_milder_realities", variants)

    # Scrap: same reality, but 6.6% of parts fail and must be remade on the production step.
    await write_history(session, machines, history_order, stream, 0, 15)
    scrap_records = []
    for rotation in range(ROTATIONS):
        actual = await replay_reality(session, machines, stream, rotation, jobs_by_order, scrap=SCRAP)
        clean = await replay_reality(session, machines, stream, rotation, jobs_by_order)
        for order in orders:
            scrap_records.append(
                (
                    actual[order.id] <= order.due_date,
                    clean[order.id] <= order.due_date,
                    (actual[order.id] - clean[order.id]).days,
                )
            )
    save(
        "scrap_effect",
        {
            "on_time_pct_without_scrap": round(100 * statistics.mean(r[1] for r in scrap_records), 1),
            "on_time_pct_with_6.6pct_scrap": round(100 * statistics.mean(r[0] for r in scrap_records), 1),
            "extra_days_avg": round(statistics.mean(r[2] for r in scrap_records), 2),
        },
    )


# ---------------------------------------------------------------- test B: real stops through the live breakdown path
async def raw(machine, kind, value, at):
    await monitoring.handle(
        Envelope(
            type="event",
            from_agent="simulator",
            action="event.machine.raw",
            payload={"machine_id": str(machine.id), "kind": kind, "value": value, "at": at.isoformat()},
        )
    )


async def test_real_stops_through_breakdown_handling(
    db_session, catalog, planning_clock, stream, fake_broker
):
    session = db_session
    machines, parts, _ = await build_factory(session, catalog)
    lathe = machines["LATHE-01"]
    # Three orders booked on the lathe today and tomorrow.
    order_ids = []
    for index in range(3):
        order = await new_order(session, catalog, parts[0], 100, NOW.date() + timedelta(days=10))
        order.status = "CONFIRMED"
        start = NOW + timedelta(hours=1 + 6 * index)
        session.add(
            ScheduleSlot(
                order_id=order.id,
                machine_id=lathe.id,
                routing_step=10,
                quantity=100,
                start_at=start,
                end_at=start + timedelta(hours=5),
                status="locked",
            )
        )
        order_ids.append(order.id)
    await session.commit()

    # The busiest real day: replay its stops on the lathe, scanning every 5 s like the maintenance agent.
    by_day: dict[int, list] = {}
    for offset, hours in stream.stops:
        by_day.setdefault(int(offset // 4), []).append((offset, hours))
    day = max(by_day.values(), key=len)
    first = day[0][0]
    scans, handled = 0, 0

    async def orchestrate(moment):
        nonlocal handled
        await drain_events(limit=100_000)
        messages = fake_broker.published_to("event.machine.unavailable")
        for message in messages[handled:]:
            await machine_replans.enqueue(Envelope.model_validate_json(message.body))
        handled = len(messages)
        await machine_replans.advance(now=moment)

    for offset, hours in day:
        down_at = NOW + timedelta(hours=1, seconds=(offset - first) * 3600)
        up_at = down_at + timedelta(hours=hours)
        await raw(lathe, "status", "running", down_at - timedelta(seconds=1))
        await raw(lathe, "status", "down", down_at)
        moment = down_at
        while moment < up_at:
            await maintenance.scan(now=moment)
            await orchestrate(moment)
            scans += 1
            moment += timedelta(seconds=5)
        await raw(lathe, "status", "running", up_at)
        await maintenance.scan(now=up_at)
        await orchestrate(up_at)
    unavailable = [
        Envelope.model_validate_json(message.body)
        for message in fake_broker.published_to("event.machine.unavailable")
    ]
    actions = dict(
        (
            await session.execute(
                select(AuditLog.action, func.count())
                .where(AuditLog.entity == machine_replans.ENTITY)
                .group_by(AuditLog.action)
            )
        ).all()
    )
    open_ended = sum(message.payload.get("to") is None for message in unavailable)
    windows = [
        round(
            (
                datetime.fromisoformat(message.payload["to"])
                - datetime.fromisoformat(message.payload["from"])
            ).total_seconds()
            / 3600,
            2,
        )
        for message in unavailable
        if message.payload.get("to")
    ]
    save(
        "breakdown_handling",
        {
            "real_stops_replayed": len(day),
            "stop_minutes_median": round(statistics.median(h * 60 for _, h in day), 1),
            "stops_10min_plus": sum(h * 60 >= 10 for _, h in day),
            "breakdowns_recorded": await session.scalar(select(func.count()).select_from(MaintenanceEvent)),
            "machine_unavailable_events": len(unavailable),
            "of_which_open_ended": open_ended,
            "estimated_outage_hours": windows,
            "replan_jobs_by_state (pending = sent to planning, skipped = machine already back)": actions,
        },
    )
    # Part counts between two jobs: which order gets them? Job 1 runs 08:00-13:00 and reports all 100,
    # job 2 starts 14:00. A count at 13:30 belongs to neither.
    await raw(lathe, "count", "100", NOW + timedelta(hours=6))
    gap = NOW + timedelta(hours=6, minutes=30)
    await raw(lathe, "count", "7", gap)
    await session.commit()
    event = await session.scalar(
        select(MachineEvent)
        .where(MachineEvent.event_type == "count")
        .order_by(MachineEvent.happened_at.desc())
    )
    save(
        "count_attribution",
        {
            "count_sent_between_jobs_went_to": "first (finished) order"
            if event.order_id == order_ids[0]
            else "no order"
            if event.order_id is None
            else str(event.order_id),
        },
    )


# ---------------------------------------------------------------- test C: speed with many booked orders
async def test_speed_with_many_orders(db_session, catalog, planning_clock):
    session = db_session
    machines, parts, _ = await build_factory(session, catalog)
    setting = await session.scalar(
        select(AppSetting).where(AppSetting.key == "planning_solver_time_limit_seconds")
    )
    setting.value = "30"  # the app default, so solver time is measured, not cut off
    randomizer = random.Random(3)
    production = [machines[code] for code in PRODUCTION]
    timings, booked = {}, 0
    for target in (50, 200, 500):
        while booked < target:
            order = Order(
                order_number=f"SO-BULK-{booked}",
                customer_id=catalog.customer.id,
                status="CONFIRMED",
                due_date=NOW.date() + timedelta(days=60),
            )
            session.add(order)
            await session.flush()
            start = NOW + timedelta(hours=randomizer.randint(1, 24 * 50))
            for step, machine in enumerate(
                (randomizer.choice(production), machines["QC-01"], machines["PACK-01"]), 1
            ):
                session.add(
                    ScheduleSlot(
                        order_id=order.id,
                        machine_id=machine.id,
                        routing_step=step * 10,
                        quantity=50,
                        start_at=start,
                        end_at=start + timedelta(hours=2),
                        status="locked",
                    )
                )
                start += timedelta(hours=2)
            booked += 1
        await session.commit()
        order = await new_order(session, catalog, parts[0], 200, NOW.date() + timedelta(days=14))
        tick = clock_time.perf_counter()
        result = await service.plan_order(session, order.id, NOW.date())
        planned = clock_time.perf_counter() - tick
        option = (
            await session.get(PlanOption, result.recommended_option_id)
            if result.recommended_option_id
            else None
        )
        tick = clock_time.perf_counter()
        if option:
            await confidence_for_option(session, option, order, now=NOW)
        timings[f"{target}_booked_orders"] = {
            "plan_order_s": round(planned, 2),
            "confidence_s": round(clock_time.perf_counter() - tick, 2),
            "options": len(result.plan_option_ids),
        }
        await service.release_plan(session, order.id)
        order.status = "CANCELLED"
        await session.commit()
    save("speed", timings)
