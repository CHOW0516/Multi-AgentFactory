"""Construct, compare, and explain feasible schedules before persistence."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from time import monotonic
from uuid import UUID
from zoneinfo import ZoneInfo

from app.agents.planning.calendar import DAY, Window, calendar, utc
from app.agents.planning.solver import Job, Placement, Solution, solve_schedule
from app.models import Machine, Order, ScheduleSlot, Shift

HOUR = Decimal(3600)


@dataclass
class Scenario:
    zone: ZoneInfo
    now: datetime
    due_date: date | None
    ready_date: date
    machines: list[Machine]
    shifts: list[Shift]
    holidays: set[date]
    maintenance: dict[UUID, list[Window]]
    locked: list[ScheduleSlot]
    jobs: list[Job]
    config: dict[str, float]
    orders: dict[UUID, Order]
    replaces: list[ScheduleSlot]
    remaining: list[ScheduleSlot] | None = None
    blocked_reason: str | None = None
    target: Order | None = None

    def finish_date(self, end: datetime) -> date:
        return (end + timedelta(hours=self.config["qc_buffer_hours"])).astimezone(
            self.zone
        ).date() + timedelta(days=self.config["shipping_buffer_days"])

    def due_cutoff(self) -> datetime | None:
        if self.due_date is None:
            return None
        shipping_day = self.due_date + DAY - timedelta(days=self.config["shipping_buffer_days"])
        return utc(shipping_day, time.min, self.zone) - timedelta(
            hours=self.config["qc_buffer_hours"], seconds=1
        )

    def blocked(self, omit: set[UUID] | frozenset[UUID] = frozenset()) -> dict[UUID, list[Window]]:
        blocks = defaultdict(
            list, {machine_id: list(windows) for machine_id, windows in self.maintenance.items()}
        )
        for slot in self.locked:
            if slot.id not in omit:
                blocks[slot.machine_id].append((slot.start_at, slot.end_at))
        return dict(blocks)

    @property
    def ready(self) -> datetime:
        active_until = self.now
        if self.remaining is not None and self.target:
            active_until = max(
                (slot.end_at for slot in self.locked if slot.order_id == self.target.id),
                default=self.now,
            )
        return max(self.now, active_until, utc(self.ready_date, time.min, self.zone))

    def horizon(self) -> datetime:
        now_day = self.now.astimezone(self.zone).date()
        ready_gap = (self.ready_date - now_day).days
        due_gap = (self.due_date - now_day).days if self.due_date else 0
        run_seconds = sum(
            step.setup_minutes * 60 + step.cycle_seconds_per_part * job.quantity
            for job in self.jobs
            for step in job.steps
        )
        if self.remaining is not None:
            run_seconds = sum((slot.end_at - slot.start_at).total_seconds() for slot in self.remaining)
        run_days = min(365, int(run_seconds / 21600) * 2)
        last_lock = max((slot.end_at for slot in self.locked), default=self.now)
        last_exclusion = max(
            (
                end
                for windows in self.maintenance.values()
                for _, end in windows
                if end != datetime.max.replace(tzinfo=UTC)
            ),
            default=self.now,
        )
        busy_gap = min(366, max((last_lock - self.now).days, (last_exclusion - self.now).days))
        days = min(730, max(28, ready_gap + run_days + 28, due_gap + 14, busy_gap + run_days + 14))
        return utc(now_day + days * DAY, time.min, self.zone)


@dataclass
class Candidate:
    kind: str
    placements: list[Placement]
    finish: datetime
    finish_date: date
    first_quantity: Decimal | None
    first_finish: date | None
    overtime_seconds: Decimal
    extra_cost: Decimal
    load: dict[str, float]
    impacted: list[dict]
    optimal: bool
    recommended: bool = False


def slot_snapshot(slot: ScheduleSlot) -> dict[str, str]:
    return {
        "id": str(slot.id),
        "machine_id": str(slot.machine_id),
        "quantity": str(slot.quantity),
        "start_at": slot.start_at.astimezone(UTC).isoformat(),
        "end_at": slot.end_at.astimezone(UTC).isoformat(),
    }


def impacted_orders(scenario: Scenario, solution: Solution, originals: list[ScheduleSlot]) -> list[dict]:
    by_source: dict[UUID, list[Placement]] = defaultdict(list)
    by_order: dict[UUID, list[ScheduleSlot]] = defaultdict(list)
    for placement in solution.placements:
        if placement.source_id is not None:
            by_source[placement.source_id].append(placement)
    for slot in originals:
        by_order[slot.order_id].append(slot)
    impacted = []
    for order_id, slots in by_order.items():
        changed = any(
            len(by_source[slot.id]) != 1
            or (by_source[slot.id][0].start, by_source[slot.id][0].end) != (slot.start_at, slot.end_at)
            for slot in slots
        )
        if not changed:
            continue
        order = scenario.orders[order_id]
        new_end = max(placement.end for slot in slots for placement in by_source[slot.id])
        old_finish = scenario.finish_date(max(slot.end_at for slot in slots))
        new_finish = scenario.finish_date(new_end)
        impacted.append(
            {
                "order_id": str(order_id),
                "order_number": order.order_number,
                "old_finish": old_finish.isoformat(),
                "new_finish": new_finish.isoformat(),
                "still_meets_due_date": order.due_date is None or new_finish <= order.due_date,
                "source_slots": [slot_snapshot(slot) for slot in slots],
            }
        )
    return impacted


def make_candidate(
    scenario: Scenario,
    kind: str,
    solution: Solution,
    regular: list[Window],
    optimal: bool,
    originals: list[ScheduleSlot],
) -> Candidate:
    impacted = impacted_orders(scenario, solution, originals) if originals else []
    moved_ids = {UUID(item["id"]) for impact in impacted for item in impact["source_slots"]}
    placements = [
        slot for slot in solution.placements if slot.source_id is None or slot.source_id in moved_ids
    ]
    target_slots = [slot for slot in placements if slot.source_id is None]
    end = max(slot.end for slot in target_slots)
    overtime = sum(
        (Decimal(int((slot.end - slot.start).total_seconds())) for slot in placements if slot.overtime),
        Decimal(0),
    )
    cost = (overtime / HOUR * Decimal(str(scenario.config["overtime_rate_per_hour"]))).quantize(
        Decimal("0.01")
    )
    regular_seconds = sum(
        max(0.0, (min(end, right) - left).total_seconds()) for left, right in regular if left < end
    )
    totals: dict[UUID, float] = defaultdict(float)
    overtime_by_machine: dict[UUID, float] = defaultdict(float)
    for slot in target_slots:
        seconds = (slot.end - slot.start).total_seconds()
        totals[slot.machine_id] += seconds
        if slot.overtime:
            overtime_by_machine[slot.machine_id] += seconds
    load = {
        machine.code: round(100 * totals[machine.id] / (regular_seconds + overtime_by_machine[machine.id]), 2)
        for machine in scenario.machines
        if totals[machine.id]
    }
    return Candidate(
        kind,
        placements,
        end,
        scenario.finish_date(end),
        solution.first_quantity,
        scenario.finish_date(solution.first_finish) if solution.first_finish else None,
        overtime,
        cost,
        load,
        impacted,
        optimal,
    )


def move_candidates(scenario: Scenario) -> list[list[ScheduleSlot]]:
    target = scenario.target
    if target is None:
        return []
    rows: dict[UUID, list[ScheduleSlot]] = defaultdict(list)
    for slot in scenario.locked:
        if slot.status == "locked" and slot.start_at > scenario.now:
            rows[slot.order_id].append(slot)
    target_rank = (target.priority, target.due_date or date.max)
    eligible = [
        order
        for order_id in rows
        if (order := scenario.orders.get(order_id)) is not None
        and (order.priority, order.due_date or date.max) > target_rank
        and order.status not in {"COMPLETED", "CANCELLED", "IN_PRODUCTION"}
    ]
    eligible.sort(key=lambda order: (order.due_date or date.max, order.priority, order.id), reverse=True)
    return [rows[order.id] for order in eligible]


def propose(scenario: Scenario, *, what_if: bool = False) -> tuple[list[Candidate], dict[str, str]]:
    if scenario.ready_date == date.max:
        return [], {"all": "a material shortage has no supplier lead time"}
    if scenario.blocked_reason:
        return [], {"all": scenario.blocked_reason}
    if scenario.remaining == []:
        return [], {"all": "no unstarted locked work remains to reschedule"}
    if scenario.remaining is None and (not scenario.jobs or any(not job.steps for job in scenario.jobs)):
        return [], {"all": "one or more parts have no routing"}
    time_limit = scenario.config["planning_solver_time_limit_seconds"]
    if time_limit <= 0:
        return [], {"all": "the configured solver time limit is zero"}
    horizon = scenario.horizon()
    regular, extra = calendar(scenario.now, horizon, scenario.zone, scenario.shifts, scenario.holidays)
    due = scenario.due_cutoff()
    options, reasons = [], {}
    move_sets = [] if what_if else move_candidates(scenario)
    end_at = monotonic() + time_limit
    runs = 1 if what_if else 3 + bool(move_sets)
    budget = time_limit / runs

    def attempt(kind: str, *, cutoff=None, split=False, overtime=False, moved=None, limit=budget):
        moved = moved or []
        available_time = min(end_at - monotonic(), limit)
        if available_time <= 0:
            reasons[kind] = "the solver reached its time limit"
            return None
        solution, complete = solve_schedule(
            origin=scenario.now,
            horizon=horizon,
            machines=scenario.machines,
            regular=regular,
            extra=extra,
            blocked=scenario.blocked({slot.id for slot in moved}),
            jobs=scenario.jobs,
            ready=scenario.ready,
            due=cutoff,
            split=split,
            overtime=overtime,
            relocate=moved,
            remaining=scenario.remaining,
            time_limit=available_time,
        )
        if solution is None:
            reasons[kind] = (
                "no feasible schedule was found in the planning window"
                if complete
                else "the solver reached its time limit before establishing feasibility"
            )
            return None
        reasons.pop(kind, None)
        candidate = make_candidate(scenario, kind, solution, regular, complete, moved)
        if not moved or candidate.impacted:
            options.append(candidate)
            return candidate
        reasons[kind] = "no lower-priority order needed to move"
        return None

    delay = attempt("delay")
    if what_if:
        return options, reasons
    on_time = delay and scenario.due_date and delay.finish_date <= scenario.due_date
    if on_time:
        options.insert(
            0,
            make_candidate(scenario, "as_requested", Solution(delay.placements), regular, delay.optimal, []),
        )
    else:
        reasons["as_requested"] = (
            "the regular schedule finishes after the due date"
            if delay and delay.optimal
            else "a regular schedule that meets the due date could not be established"
        )
    if scenario.remaining is not None:
        reasons["split"] = "started orders keep their previously planned batch quantities"
    elif due is not None and not on_time:
        attempt("split", cutoff=due, split=True)
    else:
        reasons["split"] = "a split requires a due date and a remaining quantity that cannot ship together"
    if due is not None:
        attempt("overtime", cutoff=due, overtime=True)
    else:
        reasons["overtime"] = "an overtime option requires a due date"
    if due is None or on_time or not move_sets:
        reasons["move_other_order"] = "there is no later lower-priority work to move for an unmet due date"
    else:
        moved = []
        move_end = min(end_at, monotonic() + budget)
        for index, group in enumerate(move_sets):
            moved.extend(group)
            limit = (move_end - monotonic()) / (len(move_sets) - index)
            if attempt("move_other_order", cutoff=due, moved=moved, limit=limit):
                break
    meets = [option for option in options if scenario.due_date and option.finish_date <= scenario.due_date]
    if meets:
        winner = min(
            meets, key=lambda option: (option.extra_cost, option.finish, option.kind != "as_requested")
        )
    else:
        winner = delay or min(options, key=lambda item: item.finish, default=None)
    if winner is not None:
        winner.recommended = True
    return options, reasons
