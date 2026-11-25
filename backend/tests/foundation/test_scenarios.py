"""Test scenarios seed and test PO files: every promised case is in the database and every PDF is made."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import (
    Approval,
    ExtractedField,
    Machine,
    MaintenanceEvent,
    Material,
    Order,
    PlanOption,
    PurchaseRequest,
    QcRecord,
    Quotation,
    ScheduleSlot,
    StockMovement,
    WorkflowRun,
)
from app.simulator.scenarios import add_scenarios
from app.simulator.seed import seed
from app.simulator.test_pos import write_test_files


async def test_scenarios_and_test_pos(db_session, tmp_path, monkeypatch):
    """One test, because seeding with real planning takes about half a minute. Each check is a helper below."""
    monkeypatch.setattr(get_settings(), "document_storage_path", str(tmp_path / "documents"))
    await seed(reset=True)
    created = await add_scenarios()
    await check_every_scenario_reaches_its_state(db_session, created)
    await check_running_orders_occupy_machines_now(db_session, created)
    await check_waiting_approvals_have_options_and_one_is_overdue(db_session, created)
    await check_decisions_replan_and_field_check(db_session, created)
    await check_materials_machines_quality_and_quotes(db_session)
    await check_test_po_files_are_written(tmp_path / "test-pos")
    with pytest.raises(RuntimeError, match="already exist"):
        await add_scenarios()


async def order(db_session, created, key) -> Order:
    return await db_session.scalar(select(Order).where(Order.order_number == created[key]))


async def check_every_scenario_reaches_its_state(db_session, scenarios):
    expected = {
        "running_lathe_1_busy": "IN_PRODUCTION",
        "running_lathe_2_qc_fail": "IN_PRODUCTION",
        "running_sheet_on_press_brake": "IN_PRODUCTION",
        "running_almost_done_qc_passing": "IN_PRODUCTION",
        "running_laser_long_job": "IN_PRODUCTION",
        "waiting_approval_easy": "WAITING_APPROVAL",
        "waiting_approval_tight_date_9h_old": "WAITING_APPROVAL",
        "waiting_approval_material_short": "WAITING_APPROVAL",
        "approved_reply_drafted": "REPLY_DRAFTED",
        "approved_customer_replied": "CUSTOMER_REPLIED",
        "declined": "DECLINED",
        "sent_back_for_replan": "REPLAN_NEEDED",
        "needs_field_check": "NEEDS_FIELD_CHECK",
        "failed": "FAILED",
    }
    assert set(scenarios) == set(expected)
    for key, state in expected.items():
        row = await order(db_session, scenarios, key)
        run = await db_session.scalar(select(WorkflowRun).where(WorkflowRun.order_id == row.id))
        assert (row.status, run.state) == (state, state), key
        assert row.source_document_id is not None, key


async def check_running_orders_occupy_machines_now(db_session, scenarios):
    now = datetime.now(UTC)
    busy = set(
        await db_session.scalars(
            select(Machine.code)
            .join(ScheduleSlot, ScheduleSlot.machine_id == Machine.id)
            .where(ScheduleSlot.status == "locked", ScheduleSlot.start_at <= now, ScheduleSlot.end_at > now)
        )
    )
    assert {"LATHE-01", "LATHE-02", "LASER-01", "BRAKE-01", "QC-01"} <= busy
    lathe_job = await order(db_session, scenarios, "running_lathe_1_busy")
    slot = await db_session.scalar(select(ScheduleSlot).where(ScheduleSlot.order_id == lathe_job.id))
    assert slot.end_at > now + timedelta(days=3)


async def check_waiting_approvals_have_options_and_one_is_overdue(db_session, scenarios):
    waiting = list(await db_session.scalars(select(Approval).where(Approval.status == "waiting")))
    assert len(waiting) == 3
    assert any(datetime.now(UTC) - row.created_at >= timedelta(hours=8) for row in waiting)
    for row in waiting:
        options = await db_session.scalar(
            select(func.count()).where(PlanOption.order_id == row.order_id, PlanOption.status == "proposed")
        )
        assert options >= 1
    tight = await order(db_session, scenarios, "waiting_approval_tight_date_9h_old")
    kinds = set(
        await db_session.scalars(select(PlanOption.option_type).where(PlanOption.order_id == tight.id))
    )
    assert "as_requested" not in kinds  # the date cannot be met, so the system suggests another


async def check_decisions_replan_and_field_check(db_session, scenarios):
    declined = await order(db_session, scenarios, "declined")
    approval = await db_session.scalar(select(Approval).where(Approval.order_id == declined.id))
    assert (approval.decision, approval.reject_reason) == ("reject", "decline")
    replan = await order(db_session, scenarios, "sent_back_for_replan")
    run = await db_session.scalar(select(WorkflowRun).where(WorkflowRun.order_id == replan.id))
    assert run.attempts["task"]["action"] == "check_and_hold"  # the orchestrator re-plans it on its next tick
    approved = await order(db_session, scenarios, "approved_reply_drafted")
    assert approved.promised_date is not None
    assert await db_session.scalar(
        select(func.count()).where(ScheduleSlot.order_id == approved.id, ScheduleSlot.status == "locked")
    )
    check = await order(db_session, scenarios, "needs_field_check")
    flagged = set(
        await db_session.scalars(
            select(ExtractedField.field_name).where(
                ExtractedField.order_id == check.id, ExtractedField.needs_check.is_(True)
            )
        )
    )
    assert {"due_date", "lines[0].revision", "lines[0].unit_price"} <= flagged


async def check_materials_machines_quality_and_quotes(db_session):
    below_minimum = (
        await db_session.execute(
            select(Material.code)
            .join(StockMovement)
            .group_by(Material.code, Material.min_stock)
            .having(func.sum(StockMovement.quantity) < Material.min_stock)
        )
    ).scalars()
    assert len(list(below_minimum)) >= 2
    assert await db_session.scalar(select(func.count()).where(PurchaseRequest.status == "sent")) == 1
    mill = await db_session.scalar(select(Machine).where(Machine.code == "MILL-02"))
    assert mill.status == "down"
    kinds = set(await db_session.scalars(select(MaintenanceEvent.maintenance_type)))
    assert kinds == {"breakdown", "planned"}
    assert await db_session.scalar(select(func.count()).where(QcRecord.result == "fail")) == 1
    assert await db_session.scalar(select(func.count()).where(StockMovement.movement_type == "scrap")) == 1
    statuses = set(await db_session.scalars(select(Quotation.status)))
    assert {"open", "accepted", "expired"} <= statuses


async def check_test_po_files_are_written(folder):
    names = await write_test_files(folder)
    assert len(names) == 21
    for name in names:
        assert (folder / name).read_bytes().startswith(b"%PDF"), name
    readme = (folder / "README.md").read_text(encoding="utf-8")
    assert all(name in readme for name in names)
