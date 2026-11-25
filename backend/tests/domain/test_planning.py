from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from time import monotonic
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.agents.planning import service
from app.agents.planning.options import propose
from app.models import Holiday, Machine, MaintenanceEvent, PlanOption, Routing, ScheduleSlot, Shift, StockHold
from app.schemas.contracts import ReplanForMachinePayload

MONDAY = date(2027, 1, 4)
TUESDAY = date(2027, 1, 5)


def at(day, hour):
    return datetime.combine(day, time(hour), tzinfo=UTC)


@pytest.fixture
async def capacity(db_session, catalog, planning_clock, fake_claude):
    async def setup(cycle_seconds=3600):
        machine = Machine(code="MILL-01", name="Mill 1", machine_type="milling")
        db_session.add_all(
            [
                machine,
                Routing(
                    part_id=catalog.part.id,
                    step_number=1,
                    machine_type="milling",
                    setup_minutes=0,
                    cycle_seconds_per_part=cycle_seconds,
                ),
                *[
                    Shift(name="Day", weekday=weekday, start_time=time(8), end_time=time(12))
                    for weekday in range(5)
                ],
            ]
        )
        await db_session.commit()
        for _ in range(15):
            fake_claude.add_response(text="This option fits the available production capacity.")
        return machine

    return setup


async def options(db_session, result):
    rows = await db_session.scalars(select(PlanOption).where(PlanOption.id.in_(result.plan_option_ids)))
    return {row.option_type: row for row in rows}


async def test_as_requested_then_recheck_detects_a_conflict(capacity, make_order, db_session):
    machine = await capacity(cycle_seconds=60)
    order, other = await make_order(due_date=MONDAY), await make_order()
    task_id = uuid4()
    result = await service.plan_order(db_session, order.id, MONDAY, task_id)
    assert result == await service.plan_order(db_session, order.id, MONDAY, task_id)
    await db_session.flush()
    proposed = await options(db_session, result)
    chosen = proposed["as_requested"]
    assert result.can_meet_due_date and result.recommended_option_id == chosen.id
    assert (await service.recheck_plan(db_session, order.id, chosen.id)).valid
    (slot,) = await service.option_slots(db_session, chosen.id)
    db_session.add(
        ScheduleSlot(
            order_id=other.id,
            machine_id=machine.id,
            routing_step=1,
            quantity=3,
            start_at=slot.start_at,
            end_at=slot.end_at,
            status="locked",
        )
    )
    await db_session.flush()
    stale = await service.recheck_plan(db_session, order.id, chosen.id)
    assert not stale.valid and "Another order took" in stale.changes[0]
    with pytest.raises(ValueError, match="Another order took"):
        await service.lock_plan(db_session, order.id, chosen.id)


async def test_delay_split_and_overtime(capacity, make_order, db_session):
    await capacity(cycle_seconds=1800)
    order = await make_order(quantity=10, due_date=MONDAY)
    result = await service.plan_order(db_session, order.id, MONDAY)
    proposed = await options(db_session, result)
    assert "as_requested" not in proposed
    delay, split, extra = proposed["delay"], proposed["split"], proposed["overtime"]
    assert delay.finish_date == TUESDAY
    assert split.split_quantity_first == 8 and split.split_finish_date_first == MONDAY
    assert split.finish_date == TUESDAY
    assert extra.finish_date == MONDAY and extra.overtime_hours == Decimal("1")
    assert extra.extra_cost == Decimal("60") and extra.margin == Decimal("190")
    assert result.recommended_option_id == extra.id


async def test_move_lower_priority_order_and_lock_atomically(capacity, make_order, db_session):
    machine = await capacity()
    order = await make_order(quantity=4, due_date=MONDAY, priority=1)
    other = await make_order(quantity=4, status="CONFIRMED", due_date=TUESDAY, priority=6)
    old = ScheduleSlot(
        order_id=other.id,
        machine_id=machine.id,
        routing_step=1,
        quantity=4,
        start_at=at(MONDAY, 8),
        end_at=at(MONDAY, 12),
        status="locked",
    )
    db_session.add(old)
    await db_session.commit()

    result = await service.plan_order(db_session, order.id, MONDAY)
    move = (await options(db_session, result))["move_other_order"]
    (impact,) = move.impacted_orders
    assert impact["order_id"] == str(other.id)
    assert impact["old_finish"] == MONDAY.isoformat()
    assert impact["new_finish"] == TUESDAY.isoformat()
    assert impact["still_meets_due_date"]
    await service.lock_plan(db_session, order.id, move.id)
    await service.lock_plan(db_session, order.id, move.id)
    await db_session.flush()
    locked = list(await db_session.scalars(select(ScheduleSlot).order_by(ScheduleSlot.start_at)))
    assert all(slot.status == "locked" for slot in locked)
    assert [(slot.order_id, slot.start_at.date()) for slot in locked] == [
        (order.id, MONDAY),
        (other.id, TUESDAY),
    ]
    assert await db_session.get(ScheduleSlot, old.id) is None
    assert other.promised_date == TUESDAY


async def test_holiday_and_maintenance_exclude_production(capacity, make_order, db_session):
    machine = await capacity()
    order = await make_order(quantity=2, due_date=MONDAY)
    db_session.add_all(
        [
            Holiday(holiday_date=MONDAY, name="Closure"),
            MaintenanceEvent(
                machine_id=machine.id,
                maintenance_type="planned",
                start_at=at(TUESDAY, 8),
                end_at=at(TUESDAY, 12),
            ),
        ]
    )
    await db_session.commit()
    result = await service.plan_order(db_session, order.id, MONDAY)
    assert not result.can_meet_due_date
    delay = (await options(db_session, result))["delay"]
    assert delay.finish_date == date(2027, 1, 6)
    assert result.recommended_option_id == delay.id


async def test_solver_budget(capacity, catalog, db_session):
    await capacity()
    scenario = await service.load_scenario(db_session, [(catalog.part.id, Decimal(250))], MONDAY, TUESDAY)
    scenario.config["planning_solver_time_limit_seconds"] = 0.005
    start = monotonic()
    candidates, reasons = propose(scenario)
    assert monotonic() - start < 1
    assert candidates or any("time limit" in reason for reason in reasons.values())
    scenario.config["planning_solver_time_limit_seconds"] = 0
    assert propose(scenario) == ([], {"all": "the configured solver time limit is zero"})


async def test_replan_affected_machine(capacity, make_order, db_session):
    down = await capacity()
    alternate = Machine(code="MILL-02", name="Mill 2", machine_type="milling")
    db_session.add(alternate)
    order = await make_order(quantity=2, due_date=MONDAY)
    db_session.add(
        ScheduleSlot(
            order_id=order.id,
            machine_id=down.id,
            routing_step=1,
            quantity=2,
            start_at=at(MONDAY, 8),
            end_at=at(MONDAY, 10),
            status="locked",
        )
    )
    await db_session.commit()
    result = await service.replan_for_machine(
        db_session,
        ReplanForMachinePayload(
            machine_id=down.id, unavailable_from=at(MONDAY, 8), unavailable_to=at(MONDAY, 12)
        ),
    )
    assert result.affected_order_ids == [order.id]
    ids = result.plan_option_ids_by_order[str(order.id)]
    assert ids
    slots = list(await db_session.scalars(select(ScheduleSlot).where(ScheduleSlot.plan_option_id.in_(ids))))
    regular = [slot for slot in slots if not slot.is_overtime and slot.start_at.date() == MONDAY]
    assert regular and {slot.machine_id for slot in regular} == {alternate.id}


async def test_what_if_is_read_only(capacity, catalog, client, auth_headers, db_session):
    await capacity(cycle_seconds=1800)
    sales = auth_headers("sales")
    quote = await client.post(
        "/api/quotations",
        headers=sales,
        json={
            "customer_id": str(catalog.customer.id),
            "part_id": str(catalog.part.id),
            "quantity": 8,
            "unit_price": "25.00",
            "quoted_due_date": MONDAY.isoformat(),
        },
    )
    assert quote.status_code == 201, quote.text
    body = {"part_id": str(catalog.part.id), "quantity": 8, "due_date": MONDAY.isoformat()}
    result = await client.post("/api/plan/what-if", headers=sales, json=body)
    by_quote = await client.post(f"/api/quotations/{quote.json()['id']}/check-date", headers=sales)
    assert result.status_code == 200, result.text
    assert result.json() == by_quote.json()
    assert result.json()["earliest_finish_date"] == MONDAY.isoformat()
    for table in (StockHold, ScheduleSlot, PlanOption):
        assert await db_session.scalar(select(func.count()).select_from(table)) == 0


async def test_started_order_replans_only_unstarted_slots(capacity, make_order, db_session):
    down = await capacity()
    alternate = Machine(code="MILL-02", name="Mill 2", machine_type="milling")
    db_session.add(alternate)
    order = await make_order(quantity=10, due_date=MONDAY, status="IN_PRODUCTION")
    friday = date(2027, 1, 1)
    done = ScheduleSlot(
        order_id=order.id,
        machine_id=down.id,
        routing_step=1,
        quantity=8,
        start_at=at(friday, 8),
        end_at=at(friday, 12),
        status="done",
    )
    future = ScheduleSlot(
        order_id=order.id,
        machine_id=down.id,
        routing_step=1,
        quantity=2,
        start_at=at(MONDAY, 8),
        end_at=at(MONDAY, 10),
        status="locked",
    )
    db_session.add_all([done, future])
    await db_session.commit()
    report = await service.replan_for_machine(
        db_session,
        ReplanForMachinePayload(
            machine_id=down.id, unavailable_from=at(MONDAY, 8), unavailable_to=at(MONDAY, 12)
        ),
    )
    chosen = await db_session.scalar(
        select(PlanOption).where(
            PlanOption.id.in_(report.plan_option_ids_by_order[str(order.id)]),
            PlanOption.is_recommended.is_(True),
        )
    )
    await service.lock_plan(db_session, order.id, chosen.id)
    await db_session.flush()
    (slot,) = await service.option_slots(db_session, chosen.id)
    assert slot.machine_id == alternate.id and slot.quantity == 2 and slot.end_at == at(MONDAY, 10)
    assert await db_session.get(ScheduleSlot, future.id) is None
    assert await db_session.get(ScheduleSlot, done.id) is not None


async def test_schedule_includes_overlap_and_maintenance(
    capacity, make_order, client, auth_headers, db_session
):
    machine = await capacity()
    order = await make_order(due_date=TUESDAY)
    db_session.add_all(
        [
            ScheduleSlot(
                order_id=order.id,
                machine_id=machine.id,
                routing_step=1,
                quantity=3,
                status="locked",
                start_at=at(MONDAY, 10),
                end_at=at(MONDAY, 12),
            ),
            MaintenanceEvent(
                machine_id=machine.id,
                maintenance_type="planned",
                start_at=at(MONDAY, 12),
                end_at=at(MONDAY, 12) + timedelta(hours=2),
            ),
        ]
    )
    await db_session.commit()
    result = await client.get(
        "/api/schedule",
        headers=auth_headers("planner"),
        params={
            "from": at(MONDAY, 11).isoformat(),
            "to": at(TUESDAY, 0).isoformat(),
            "machine_id": str(machine.id),
        },
    )
    assert result.status_code == 200, result.text
    assert len(result.json()["slots"]) == len(result.json()["maintenance"]) == 1
