"""Energy cost on plan options and the cheaper-energy option."""

from datetime import UTC, date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.agents.planning import service
from app.agents.planning.energy import Tariff, energy_use
from app.models import AppSetting, Machine, PlanOption

MONDAY = date(2027, 1, 4)
WEDNESDAY = date(2027, 1, 6)
SATURDAY = date(2027, 1, 9)
UTC_ZONE = ZoneInfo("UTC")

# Peak 08:00-10:00 on weekdays. Test shifts are 08:00-12:00, so 10:00-12:00 is off-peak shift time.
PEAK_SETTINGS = {
    "energy_enabled": 1,
    "energy_peak_start_minute": 8 * 60,
    "energy_peak_end_minute": 10 * 60,
    "energy_peak_weekends": 0,
    "energy_peak_holidays": 0,
    "energy_peak_rate": 1.0,
    "energy_offpeak_rate": 0.5,
    "energy_heavy_machine_kw": 15,
}


def at(day, hour, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=UTC)


def tariff(holidays=(), **changes):
    return Tariff.from_config(PEAK_SETTINGS | changes, UTC_ZONE, holidays)


def machine(running_kw=20):
    return Machine(code="M", name="M", machine_type="milling", running_kw=running_kw)


# ---------------------------------------------------------------- tariff and cost
def test_job_across_the_peak_boundary_is_split_by_the_minute():
    assert tariff().peak_seconds(at(MONDAY, 9, 30), at(MONDAY, 11)) == 30 * 60


def test_weekend_and_holiday_are_off_peak_unless_set():
    assert tariff().peak_seconds(at(SATURDAY, 8), at(SATURDAY, 10)) == 0
    assert tariff(energy_peak_weekends=1).peak_seconds(at(SATURDAY, 8), at(SATURDAY, 10)) == 7200
    assert tariff(holidays={MONDAY}).peak_seconds(at(MONDAY, 8), at(MONDAY, 10)) == 0
    assert tariff({MONDAY}, energy_peak_holidays=1).peak_seconds(at(MONDAY, 8), at(MONDAY, 10)) == 7200


def test_peak_that_crosses_midnight():
    night = tariff(energy_peak_start_minute=22 * 60, energy_peak_end_minute=6 * 60)
    tuesday = date(2027, 1, 5)
    assert night.peak_seconds(at(MONDAY, 21), at(tuesday, 7)) == 8 * 3600
    # Friday night belongs to Friday (a peak day); Saturday night does not.
    assert night.peak_seconds(at(date(2027, 1, 8), 23), at(SATURDAY, 1)) == 2 * 3600
    assert night.peak_seconds(at(SATURDAY, 23), at(date(2027, 1, 10), 1)) == 0


def test_same_start_and_end_means_no_peak():
    flat = tariff(energy_peak_start_minute=600, energy_peak_end_minute=600)
    assert flat.peak_seconds(at(MONDAY, 0), at(WEDNESDAY, 0)) == 0
    assert not flat.peak_saves_money


def test_energy_cost_splits_peak_and_off_peak():
    mill = machine()
    mill.id = "m1"
    use = energy_use(tariff(), {"m1": mill}, [("m1", at(MONDAY, 9), at(MONDAY, 11))])
    assert use.kwh == Decimal("40.00") and use.peak_kwh == Decimal("20.00")
    assert use.cost == Decimal("30.00")  # 20 kWh x 1.0 + 20 kWh x 0.5


def test_no_cost_when_energy_is_off_or_machine_has_no_kw():
    mill, untracked = machine(), machine(running_kw=None)
    mill.id, untracked.id = "m1", "m2"
    slot = ("m1", at(MONDAY, 9), at(MONDAY, 11))
    assert energy_use(tariff(energy_enabled=0), {"m1": mill}, [slot]) is None
    assert energy_use(tariff(), {"m2": untracked}, [("m2", *slot[1:])]) is None


def test_cheaper_peak_rate_means_no_saving():
    assert not tariff(energy_peak_rate=0.4).peak_saves_money
    assert not tariff(energy_enabled=0).peak_saves_money


# ---------------------------------------------------------------- planning
async def energy_settings(db_session, **changes):
    db_session.add_all(
        AppSetting(key=key, value=str(value)) for key, value in (PEAK_SETTINGS | changes).items()
    )
    await db_session.commit()


async def options(db_session, result):
    rows = await db_session.scalars(select(PlanOption).where(PlanOption.id.in_(result.plan_option_ids)))
    return {row.option_type: row for row in rows}


async def heavy_machine(db_session, capacity, running_kw=20):
    mill = await capacity(cycle_seconds=3600)
    mill.running_kw = Decimal(running_kw)
    await db_session.commit()
    return mill


async def test_cheaper_energy_option_is_offered_and_recommended(capacity, make_order, db_session):
    await heavy_machine(db_session, capacity)
    await energy_settings(db_session)
    order = await make_order(quantity=2, due_date=WEDNESDAY)
    result = await service.plan_order(db_session, order.id, MONDAY)
    proposed = await options(db_session, result)
    normal, cheaper = proposed["as_requested"], proposed["cheaper_energy"]
    assert normal.energy_kwh == Decimal("40.00") and normal.energy_cost == Decimal("40.00")
    assert cheaper.energy_cost == Decimal("20.00")
    assert cheaper.finish_date <= WEDNESDAY
    assert result.recommended_option_id == cheaper.id
    assert "20.00 MYR less than the normal plan" in cheaper.explanation
    for slot in await service.option_slots(db_session, cheaper.id):
        assert tariff().peak_seconds(slot.start_at, slot.end_at) == 0
    # Energy is a real cost, so it lowers the margin.
    assert cheaper.margin - normal.margin == Decimal("20.00")


async def test_no_cheaper_energy_option_without_a_due_date(capacity, make_order, db_session):
    await heavy_machine(db_session, capacity)
    await energy_settings(db_session)
    order = await make_order(quantity=2)
    proposed = await options(db_session, await service.plan_order(db_session, order.id, MONDAY))
    assert "cheaper_energy" not in proposed
    assert proposed["delay"].energy_cost == Decimal("40.00")


async def test_no_cheaper_energy_option_when_the_due_date_needs_peak_time(capacity, make_order, db_session):
    await heavy_machine(db_session, capacity)
    await energy_settings(db_session)
    order = await make_order(quantity=4, due_date=MONDAY)  # needs the whole Monday shift, peak included
    result = await service.plan_order(db_session, order.id, MONDAY)
    proposed = await options(db_session, result)
    assert "cheaper_energy" not in proposed
    assert result.recommended_option_id == proposed["as_requested"].id
    assert "cheaper energy: there is not enough off-peak shift time" in proposed["as_requested"].explanation


async def test_light_machine_is_not_moved_out_of_peak(capacity, make_order, db_session):
    await heavy_machine(db_session, capacity, running_kw=5)
    await energy_settings(db_session)
    order = await make_order(quantity=2, due_date=WEDNESDAY)
    proposed = await options(db_session, await service.plan_order(db_session, order.id, MONDAY))
    assert "cheaper_energy" not in proposed
    assert proposed["as_requested"].energy_cost == Decimal("10.00")


async def test_energy_off_shows_no_cost_and_no_option(capacity, make_order, db_session):
    await heavy_machine(db_session, capacity)
    await energy_settings(db_session, energy_enabled=0)
    order = await make_order(quantity=2, due_date=WEDNESDAY)
    proposed = await options(db_session, await service.plan_order(db_session, order.id, MONDAY))
    assert "cheaper_energy" not in proposed
    assert proposed["as_requested"].energy_cost is None
    assert "cheaper energy" not in proposed["as_requested"].explanation


# ---------------------------------------------------------------- API
async def test_energy_settings_are_validated(client, auth_headers):
    admin = auth_headers("admin")
    ok = await client.patch(
        "/api/settings", json={"values": {"energy_peak_start_minute": 840}}, headers=admin
    )
    assert ok.status_code == 200 and ok.json()["values"]["energy_peak_start_minute"] == 840
    for bad in ({"energy_peak_end_minute": 1440}, {"energy_enabled": 2}, {"energy_peak_rate": -1}):
        assert (await client.patch("/api/settings", json={"values": bad}, headers=admin)).status_code == 422


async def test_machine_kw_is_edited_by_admin_only(client, auth_headers, db_session):
    mill = Machine(code="MILL-09", name="Mill 9", machine_type="milling")
    db_session.add(mill)
    await db_session.commit()
    body = {"running_kw": "18.5", "idle_kw": "2"}
    path = f"/api/machines/{mill.id}/energy"
    assert (await client.patch(path, json=body, headers=auth_headers("planner"))).status_code == 403
    saved = await client.patch(path, json=body, headers=auth_headers("admin"))
    assert saved.status_code == 200
    assert Decimal(saved.json()["running_kw"]) == Decimal("18.5")
    cleared = await client.patch(
        path, json={"running_kw": None, "idle_kw": None}, headers=auth_headers("admin")
    )
    assert cleared.json()["running_kw"] is None
    negative = await client.patch(path, json={"running_kw": -1}, headers=auth_headers("admin"))
    assert negative.status_code == 422
