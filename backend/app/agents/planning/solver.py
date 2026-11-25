"""CP-SAT job-shop model. Machine work time skips shifts, holidays, and blocked slots."""

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from time import monotonic
from uuid import UUID

from ortools.sat.python import cp_model

from app.agents.planning.calendar import Window, cut
from app.models import Machine, Routing, ScheduleSlot


@dataclass(frozen=True)
class Job:
    quantity: Decimal
    steps: list[Routing]


@dataclass(frozen=True)
class Placement:
    machine_id: UUID
    step: int
    quantity: Decimal
    start: datetime
    end: datetime
    overtime: bool
    source_id: UUID | None = None


@dataclass
class Solution:
    placements: list[Placement]
    first_quantity: Decimal | None = None
    first_finish: datetime | None = None


@dataclass(frozen=True)
class Segment:
    wall_start: int
    work_start: int
    size: int
    overtime: bool
    prior_overtime: int

    @property
    def work_end(self) -> int:
        return self.work_start + self.size


@dataclass
class MachineTime:
    machine: Machine
    segments: list[Segment]
    length: int
    overtime: int

    def place(self, origin, work_start, work_end, step, quantity, source_id) -> list[Placement]:
        result = []
        for segment in self.segments:
            left, right = max(segment.work_start, work_start), min(segment.work_end, work_end)
            if left < right:
                offset = segment.wall_start - segment.work_start
                result.append(
                    Placement(
                        self.machine.id,
                        step,
                        quantity,
                        origin + timedelta(seconds=offset + left),
                        origin + timedelta(seconds=offset + right),
                        segment.overtime,
                        source_id,
                    )
                )
        return result


def machine_time(
    machine: Machine, origin: datetime, regular: list[Window], extra: list[Window], blocked: list[Window]
) -> MachineTime:
    regular_windows = [(start, end, False) for start, end in cut(regular, blocked)]
    overtime_windows = [(start, end, True) for start, end in cut(extra, blocked)]
    segments, work, overtime = [], 0, 0
    for start, end, is_overtime in sorted(regular_windows + overtime_windows):
        left = math.ceil((start - origin).total_seconds())
        right = math.floor((end - origin).total_seconds())
        size = right - left
        if size > 0:
            segments.append(Segment(left, work, size, is_overtime, overtime))
            work += size
            if is_overtime:
                overtime += size
    return MachineTime(machine, segments, work, overtime)


@dataclass
class Assignment:
    clock: MachineTime
    selected: cp_model.IntVar
    start: cp_model.IntVar
    end: cp_model.IntVar


@dataclass
class Operation:
    start: cp_model.IntVar
    end: cp_model.IntVar
    count: cp_model.IntVar
    scale: int
    step: int
    source_id: UUID | None
    source_quantity: Decimal | None
    assignments: list[Assignment] = field(default_factory=list)


class ScheduleModel:
    def __init__(self, origin: datetime, end: datetime, clocks: list[MachineTime]) -> None:
        self.origin = origin
        self.horizon = self.offset(end)
        self.clocks = clocks
        self.model = cp_model.CpModel()
        self.intervals: dict[UUID, list[cp_model.IntervalVar]] = defaultdict(list)
        self.overtime: list[cp_model.IntVar] = []
        self.operations: list[Operation] = []

    def offset(self, value: datetime) -> int:
        return math.ceil((value - self.origin).total_seconds())

    def _wall_point(self, clock, position, wall, selected, *, start: bool):
        overtime = self.model.new_int_var(0, clock.overtime, "elapsed_overtime")
        choices = []
        for segment in clock.segments:
            chosen = self.model.new_bool_var("calendar_segment")
            choices.append(chosen)
            lower = segment.work_start if start else segment.work_start + 1
            upper = segment.work_end - 1 if start else segment.work_end
            self.model.add_linear_constraint(position, lower, upper).only_enforce_if(chosen)
            self.model.add(wall == position + segment.wall_start - segment.work_start).only_enforce_if(chosen)
            elapsed = segment.prior_overtime
            if segment.overtime:
                elapsed = elapsed + position - segment.work_start
            self.model.add(overtime == elapsed).only_enforce_if(chosen)
        self.model.add(sum(choices) == selected)
        self.model.add(overtime == 0).only_enforce_if(~selected)
        return overtime

    def add_operation(
        self,
        *,
        machines: list[MachineTime],
        duration: cp_model.IntVar,
        minimum_duration: int,
        count: cp_model.IntVar,
        scale: int,
        active: cp_model.IntVar,
        step: int,
        earliest: int,
        deadline: int | None = None,
        source: ScheduleSlot | None = None,
        keep_source_id: bool = True,
    ) -> Operation:
        model = self.model
        start = model.new_int_var(0, self.horizon, "start")
        end = model.new_int_var(0, self.horizon, "end")
        model.add(start >= earliest).only_enforce_if(active)
        model.add(end == 0).only_enforce_if(~active)
        if deadline is not None:
            model.add(end <= deadline).only_enforce_if(active)
        operation = Operation(
            start,
            end,
            count,
            scale,
            step,
            source.id if source and keep_source_id else None,
            source.quantity if source else None,
        )
        for clock in machines:
            if clock.length < minimum_duration:
                continue
            selected = model.new_bool_var("use_machine")
            work_start = model.new_int_var(0, clock.length, "work_start")
            work_end = model.new_int_var(0, clock.length, "work_end")
            interval = model.new_optional_interval_var(
                work_start, duration, work_end, selected, "machine_interval"
            )
            self.intervals[clock.machine.id].append(interval)
            start_ot = self._wall_point(clock, work_start, start, selected, start=True)
            end_ot = self._wall_point(clock, work_end, end, selected, start=False)
            if clock.overtime:
                overtime = model.new_int_var(0, clock.overtime, "operation_overtime")
                model.add(overtime == end_ot - start_ot)
                self.overtime.append(overtime)
            operation.assignments.append(Assignment(clock, selected, work_start, work_end))
        model.add(sum(item.selected for item in operation.assignments) == active)
        self.operations.append(operation)
        return operation

    def add_job(self, job: Job, count, scale: int, earliest: int, deadline: int | None = None):
        model = self.model
        active = model.new_bool_var("batch_used")
        model.add(count >= 1).only_enforce_if(active)
        model.add(count == 0).only_enforce_if(~active)
        previous = None
        for step in job.steps:
            rate = int(step.cycle_seconds_per_part * 100)
            denominator = scale * 100
            setup = step.setup_minutes * 60
            cycles = model.new_int_var(0, self.horizon, "cycle_seconds")
            model.add(cycles * denominator >= rate * count)
            model.add(cycles * denominator <= rate * count + denominator - 1)
            duration = model.new_int_var(1, self.horizon, "operation_seconds")
            model.add_max_equality(duration, [cycles + setup, 1])
            compatible = [clock for clock in self.clocks if clock.machine.machine_type == step.machine_type]
            operation = self.add_operation(
                machines=compatible,
                duration=duration,
                minimum_duration=max(1, setup + math.ceil(rate / denominator)),
                count=count,
                scale=scale,
                active=active,
                step=step.step_number,
                earliest=earliest,
                deadline=deadline,
            )
            if previous is not None:
                model.add(operation.start >= previous.end).only_enforce_if(active)
            previous = operation
        return previous.end

    def add_existing_work(
        self,
        slots: list[ScheduleSlot],
        *,
        relocating: bool,
        earliest: int = 0,
        deadline: int | None = None,
    ) -> list[cp_model.IntVar]:
        model = self.model
        machine_types = {clock.machine.id: clock.machine.machine_type for clock in self.clocks}
        per_order: dict[UUID, list[tuple[ScheduleSlot, Operation]]] = defaultdict(list)
        for slot in sorted(slots, key=lambda item: (item.start_at, item.end_at, item.id)):
            duration = max(1, math.ceil((slot.end_at - slot.start_at).total_seconds()))
            if relocating:
                machines = [clock for clock in self.clocks if clock.machine.id == slot.machine_id]
            else:
                machines = [
                    clock
                    for clock in self.clocks
                    if clock.machine.machine_type == machine_types[slot.machine_id]
                ]
            operation = self.add_operation(
                machines=machines,
                duration=model.new_constant(duration),
                minimum_duration=duration,
                count=model.new_constant(1),
                scale=1,
                active=model.new_constant(1),
                step=slot.routing_step,
                earliest=max(0, self.offset(slot.start_at)) if relocating else earliest,
                deadline=deadline,
                source=slot,
                keep_source_id=relocating,
            )
            for previous, previous_operation in per_order[slot.order_id]:
                if previous.end_at <= slot.start_at:
                    model.add(operation.start >= previous_operation.end)
                elif previous.machine_id == slot.machine_id:
                    model.add(operation.start >= previous_operation.end)
            per_order[slot.order_id].append((slot, operation))
        return [op.end for rows in per_order.values() for _, op in rows]

    def solve(self, time_limit: float) -> tuple[cp_model.CpSolver, cp_model.CpSolverStatus]:
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit
        solver.parameters.num_search_workers = 1
        status = solver.solve(self.model)
        if status == cp_model.MODEL_INVALID:
            raise ValueError(f"Invalid scheduling data: {self.model.validate()}")
        return solver, status

    def placements(self, solver: cp_model.CpSolver) -> list[Placement]:
        placements = []
        for operation in self.operations:
            quantity = operation.source_quantity
            if quantity is None:
                quantity = Decimal(solver.value(operation.count)) / operation.scale
            for assignment in operation.assignments:
                if solver.boolean_value(assignment.selected):
                    placements.extend(
                        assignment.clock.place(
                            self.origin,
                            solver.value(assignment.start),
                            solver.value(assignment.end),
                            operation.step,
                            quantity,
                            operation.source_id,
                        )
                    )
        return sorted(placements, key=lambda slot: (slot.start, slot.end, slot.machine_id, slot.step))


def solve_schedule(
    *,
    origin: datetime,
    horizon: datetime,
    machines: list[Machine],
    regular: list[Window],
    extra: list[Window],
    blocked: dict[UUID, list[Window]],
    jobs: list[Job],
    ready: datetime,
    time_limit: float,
    due: datetime | None = None,
    split: bool = False,
    overtime: bool = False,
    relocate: list[ScheduleSlot] | None = None,
    remaining: list[ScheduleSlot] | None = None,
) -> tuple[Solution | None, bool]:
    stop = monotonic() + time_limit
    if ready >= horizon or (due is not None and due <= ready):
        return None, True
    if remaining is None and (not jobs or any(not job.steps for job in jobs)):
        return None, True
    maximum_seconds = (horizon - origin).total_seconds() * (2 if split else 1)
    if remaining is None and any(
        step.setup_minutes * 60 + step.cycle_seconds_per_part * job.quantity > maximum_seconds
        for job in jobs
        for step in job.steps
    ):
        return None, True
    clocks = [
        machine_time(machine, origin, regular, extra if overtime else [], blocked.get(machine.id, []))
        for machine in machines
    ]
    schedule = ScheduleModel(origin, horizon, clocks)
    model = schedule.model
    earliest = max(0, schedule.offset(ready))
    deadline = math.floor((due - origin).total_seconds()) if due is not None else None
    finished, first_ends, first_counts = [], [], []
    if remaining:
        finished.extend(
            schedule.add_existing_work(remaining, relocating=False, earliest=earliest, deadline=deadline)
        )
    for job in jobs if remaining is None else []:
        scale = 1 if job.quantity == job.quantity.to_integral_value() else 1000
        units = int(job.quantity * scale)
        if split:
            first = model.new_int_var(0, units, "first_quantity")
            rest = model.new_int_var(0, units, "remaining_quantity")
            model.add(first + rest == units)
            first_counts.append(first * (1000 // scale))
            first_ends.append(schedule.add_job(job, first, scale, earliest, deadline))
            finished.append(schedule.add_job(job, rest, scale, earliest))
        else:
            finished.append(schedule.add_job(job, model.new_constant(units), scale, earliest, deadline))

    finish = model.new_int_var(0, schedule.horizon, "order_finish")
    model.add_max_equality(finish, finished + first_ends)
    first_finish = None
    refine_split = False
    if split:
        first_quantity = sum(first_counts)
        total = int(sum(job.quantity for job in jobs) * 1000)
        model.add_linear_constraint(first_quantity, 1, total - 1)
        first_finish = model.new_int_var(0, schedule.horizon, "first_finish")
        model.add_max_equality(first_finish, first_ends)
        if total * (schedule.horizon + 1) < 2**60:
            model.maximize(first_quantity * (schedule.horizon + 1) - finish)
        else:
            model.maximize(first_quantity)
            refine_split = True
    elif overtime:
        overtime_used = sum(schedule.overtime)
        model.add(overtime_used >= 1)
        model.minimize(overtime_used * (schedule.horizon + 1) + finish)
    elif relocate:
        displaced_ends = schedule.add_existing_work(relocate, relocating=True)
        model.minimize(sum(displaced_ends) + finish)
    else:
        model.minimize(finish)

    for intervals in schedule.intervals.values():
        model.add_no_overlap(intervals)
    available = stop - monotonic()
    if available <= 0:
        return None, False
    solver, status = schedule.solve(available * 0.8 if refine_split else available)
    if status not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
        return None, status == cp_model.INFEASIBLE
    optimal = status == cp_model.OPTIMAL
    available = stop - monotonic()
    if refine_split and available > 0:
        model.add(first_quantity == solver.value(first_quantity))
        model.minimize(finish)
        refined, refinement_status = schedule.solve(available)
        if refinement_status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            solver = refined
        optimal = optimal and refinement_status == cp_model.OPTIMAL
    return Solution(
        placements=schedule.placements(solver),
        first_quantity=Decimal(solver.value(sum(first_counts))) / 1000 if split else None,
        first_finish=origin + timedelta(seconds=solver.value(first_finish)) if split else None,
    ), optimal
