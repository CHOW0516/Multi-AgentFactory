"""Regression tests for the pre-release audit fixes (reviews/pre-release-audit-2026-11-25.md)."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.agents.material import service as material
from app.agents.monitoring import handle as monitor
from app.agents.order import mail
from app.agents.order.extraction import check_against_document, extract_document
from app.agents.order.intake import Attachment, store_documents
from app.agents.planning.service import maintenance_windows
from app.core.config import Settings, get_settings
from app.llm import client as llm_client
from app.models import (
    BomLine,
    ExtractedField,
    Machine,
    MaintenanceEvent,
    Notification,
    Order,
    PurchaseRequest,
    ScheduleSlot,
    StockHold,
    WorkflowRun,
)
from app.orchestrator import workflow
from app.schemas.envelope import Envelope

FILES = sorted((Path(__file__).parent / "fixtures" / "pos").glob("*.pdf"))


def field(value):
    return {"value": value, "confidence": 0.98, "source_text": value}


def extraction():
    line = {"part_number": "PX-14", "revision": "A", "quantity": "10", "unit_price": "25.00"}
    return {
        "customer_name": field("ACME"),
        "po_number": field("PO-100"),
        "po_revision": field("A"),
        "due_date": field("2027-02-12"),
        "delivery_address": field("42 Industrial Way"),
        "notes": field(None),
        "lines": [{key: field(value) for key, value in line.items()}],
    }


def machine_event(machine, kind, value, at):
    return Envelope(
        type="event",
        from_agent="simulator",
        action="event.machine.raw",
        payload={"machine_id": str(machine.id), "kind": kind, "value": value, "at": at.isoformat()},
    )


async def test_breakdown_closes_when_the_machine_runs_again(db_session):
    """C1: a down machine that recovers must not stay blocked in planning forever."""
    machine = Machine(code="MILL-09", name="Mill 9", machine_type="milling", status="running")
    db_session.add(machine)
    await db_session.commit()
    start = datetime.now(UTC) - timedelta(hours=2)
    await monitor(machine_event(machine, "status", "down", start))
    await monitor(machine_event(machine, "status", "running", start + timedelta(minutes=45)))
    breakdown = await db_session.scalar(
        select(MaintenanceEvent).where(MaintenanceEvent.machine_id == machine.id)
    )
    await db_session.refresh(breakdown)
    await db_session.refresh(machine)
    assert breakdown.end_at == start + timedelta(minutes=45)
    assert breakdown.downtime_hours == Decimal("0.75")
    assert await maintenance_windows(db_session, [machine], datetime.now(UTC)) == {}


async def add_bom(db_session, catalog, per_part="2"):
    db_session.add(
        BomLine(part_id=catalog.part.id, material_id=catalog.material.id, quantity_per_part=Decimal(per_part))
    )
    await db_session.commit()


async def test_issuing_material_uses_up_the_order_hold(
    db_session, catalog, make_order, make_stock, client, auth_headers
):
    """C2: issued stock must not be counted twice (once as stock, once as a hold)."""
    await add_bom(db_session, catalog)
    await make_stock(100)
    order = await make_order(quantity=10)
    await material.check_and_hold(db_session, order.id)
    await material.confirm_holds(db_session, order.id)
    await db_session.commit()
    response = await client.post(
        "/api/stock-movements",
        headers=auth_headers("store"),
        json={
            "material_id": str(catalog.material.id),
            "quantity": "15",
            "movement_type": "issue",
            "order_id": str(order.id),
        },
    )
    assert response.status_code == 201, response.text
    hold = await db_session.scalar(select(StockHold).where(StockHold.order_id == order.id))
    await db_session.refresh(hold)
    assert hold.quantity == Decimal("5")  # 20 held, 15 issued
    stock, held = await material.balances(db_session, [catalog.material.id], datetime.now(UTC))
    assert stock[catalog.material.id] - held[catalog.material.id] == Decimal("80")


async def test_cancel_frees_holds_slots_and_purchase_requests(
    db_session, catalog, make_order, make_stock, client, auth_headers
):
    """H1: a closed order keeps no stock, machine time or draft purchase requests."""
    await add_bom(db_session, catalog)
    await make_stock(5)
    order = await make_order(quantity=10, status="CONFIRMED")
    db_session.add(WorkflowRun(order_id=order.id, state="CONFIRMED", attempts={}))
    machine = Machine(code="LATHE-09", name="Lathe 9", machine_type="turning")
    db_session.add(machine)
    await db_session.flush()
    now = datetime.now(UTC)
    slot = dict(order_id=order.id, machine_id=machine.id, routing_step=1, quantity=10, status="locked")
    db_session.add_all(
        [
            ScheduleSlot(**slot, start_at=now - timedelta(hours=1), end_at=now + timedelta(hours=1)),
            ScheduleSlot(**slot, start_at=now + timedelta(days=1), end_at=now + timedelta(days=1, hours=2)),
        ]
    )
    await db_session.commit()
    await material.check_and_hold(db_session, order.id)
    await material.confirm_holds(db_session, order.id)
    await material.create_purchase_requests(db_session, order.id)
    await db_session.commit()

    response = await client.post(
        f"/api/orders/{order.id}/cancel",
        headers=auth_headers("manager"),
        json={"reason": "Customer cancelled"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "CANCELLED"
    assert await db_session.scalar(select(func.count()).select_from(StockHold)) == 0
    slots = list(await db_session.scalars(select(ScheduleSlot).execution_options(populate_existing=True)))
    assert [slot.status for slot in slots] == ["done"]  # in-progress slot ended now, future slot freed
    statuses = set(
        await db_session.scalars(select(PurchaseRequest.status).execution_options(populate_existing=True))
    )
    assert statuses == {"cancelled"}
    with pytest.raises(ValueError, match="CANCELLED"):
        await material.check_and_hold(db_session, order.id)


async def test_failed_order_can_be_retried(db_session, make_order, client, auth_headers):
    """H1: FAILED is not a dead end; the manager can run the failed step again."""
    order = await make_order()
    run = WorkflowRun(order_id=order.id, state="VERIFIED", attempts={})
    db_session.add(run)
    await db_session.flush()
    workflow.order_task(run, "material", "check_and_hold")
    await workflow.fail(db_session, order, run, "check_and_hold timed out")
    await db_session.commit()
    response = await client.post(f"/api/orders/{order.id}/retry", headers=auth_headers("manager"))
    assert response.status_code == 200, response.text
    await db_session.refresh(run)
    assert run.state == "VERIFIED" and run.attempts["task"]["action"] == "check_and_hold"


async def extract_po(fake_ai, po_revision="A"):
    data = extraction()
    data["po_revision"]["value"] = data["po_revision"]["source_text"] = po_revision
    fake_ai.add_response(text=json.dumps(data))
    (order,) = await store_documents([Attachment(FILES[0].name, FILES[0].read_bytes())])
    return order, await extract_document(order.source_document_id)


@pytest.mark.parametrize("first_status", ["WAITING_APPROVAL", "CONFIRMED", "IN_PRODUCTION"])
async def test_resent_po_is_flagged_as_duplicate(first_status, db_session, make_order, fake_ai, fake_broker):
    """C3: the same PO number and revision again is a duplicate; the first order is untouched."""
    first = await make_order(status=first_status, po_number="PO-100")
    first.po_revision = "A"
    await db_session.commit()
    order, result = await extract_po(fake_ai)
    assert "po_number" in result.fields_needing_check
    assert not fake_broker.published_to("event.order.revised")
    reason = await db_session.scalar(
        select(ExtractedField.check_reason).where(
            ExtractedField.order_id == order.id, ExtractedField.field_name == "po_number"
        )
    )
    assert first.order_number in reason


async def test_revision_of_order_in_production_is_not_released(db_session, make_order, fake_ai, fake_broker):
    first = await make_order(status="IN_PRODUCTION", po_number="PO-100")
    first.po_revision = "A"
    await db_session.commit()
    _, result = await extract_po(fake_ai, po_revision="B")
    assert "po_number" in result.fields_needing_check
    assert not fake_broker.published_to("event.order.revised")


async def test_revision_of_waiting_order_replaces_it(db_session, make_order, fake_ai, fake_broker):
    first = await make_order(status="WAITING_APPROVAL", po_number="PO-100")
    first.po_revision = "A"
    await db_session.commit()
    order, _ = await extract_po(fake_ai, po_revision="B")
    order = await db_session.get(Order, order.id, populate_existing=True)
    assert order.previous_order_id == first.id
    assert len(fake_broker.published_to("event.order.revised")) == 1


def po_email(sender, *attachments):
    message = EmailMessage()
    message["Message-ID"] = f"<{sender}-{len(attachments)}@example.test>"
    message["From"] = sender
    message["Subject"] = "Purchase order"
    message.set_content("Please see the attached order.")
    for name, data, maintype, subtype, content_id in attachments:
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
        if content_id:
            message.get_payload()[-1]["Content-ID"] = content_id
    return message.as_bytes()


async def test_unknown_sender_waits_for_sales(catalog, db_session, fake_broker, users):
    """H5: an unknown sender cannot start an AI extraction."""
    pdf = FILES[0].read_bytes()
    metadata, files, _ = mail.message_parts(
        po_email("spam@unknown.example", ("po.pdf", pdf, "application", "pdf", None))
    )
    (order,) = await store_documents(files, email=metadata)
    assert order.status == "SENDER_REVIEW"
    assert not fake_broker.published_to("event.order.received")
    assert await db_session.scalar(
        select(func.count()).select_from(Notification).where(Notification.kind == "sender_review")
    )


async def test_logos_are_skipped_and_unreadable_files_reported(catalog, db_session, users):
    pdf = FILES[0].read_bytes()
    raw = po_email(
        "purchasing@example.test",
        ("po.pdf", pdf, "application", "pdf", None),
        ("logo.png", b"\x89PNG" + b"0" * 2000, "image", "png", "<logo>"),
        ("terms.doc", b"old word file", "application", "msword", None),
    )
    metadata, files, skipped = mail.message_parts(raw)
    assert [file.filename for file in files] == ["po.pdf"]
    assert skipped == ["terms.doc"]
    await mail.report_skipped(metadata, skipped)
    note = await db_session.scalar(select(Notification).where(Notification.kind == "email_skipped"))
    assert "terms.doc" in note.body


def test_source_text_is_checked_against_the_document():
    """H8: the model's confidence is not trusted on its own."""
    rows = [
        ExtractedField(
            field_name="po_number", value="PO-999", source_text="PO-999", confidence=Decimal("0.99")
        ),
        ExtractedField(
            field_name="lines[0].quantity", value="100", source_text="100", confidence=Decimal("0.99")
        ),
        ExtractedField(
            field_name="lines[0].unit_price", value="25.00", source_text="25", confidence=Decimal("0.99")
        ),
        ExtractedField(
            field_name="due_date", value="2027-02-12", source_text="12 Feb 2027", confidence=Decimal("0.99")
        ),
    ]
    check_against_document(
        rows, [{"type": "text", "text": "PO number: PO-123\nQty 10 at 25\nDue 12 Feb 2027"}]
    )
    assert [row.field_name for row in rows if row.needs_check] == ["po_number", "lines[0].quantity"]


async def test_unpriced_model_is_refused(fake_ai, monkeypatch, db_session):
    monkeypatch.setattr(get_settings(), "ai_model", "someone/unpriced-model")
    with pytest.raises(llm_client.LlmUnavailable) as error:
        await llm_client.call_ai("material", "explain", [{"role": "user", "content": "hi"}])
    assert error.value.retryable is False
    assert fake_ai.requests == []


async def test_truncated_structured_reply_is_not_parsed(fake_ai, db_session):
    fake_ai.add_response(text='{"po_number": ', stop_reason="length")
    with pytest.raises(llm_client.LlmTruncated):
        await llm_client.call_ai(
            "order", "extraction", [{"role": "user", "content": "x"}], response_schema={"type": "object"}
        )


def test_production_refuses_placeholder_secrets(monkeypatch):
    monkeypatch.setenv("APP_MODE", "production")
    monkeypatch.setenv("JWT_SECRET", "change-me-long-random")
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings()


async def test_login_is_rate_limited(client, users):
    from app.api import auth

    auth.failed_logins.clear()
    for _ in range(auth.MAX_FAILED_LOGINS):
        response = await client.post("/api/auth/login", json={"email": "nobody@x.test", "password": "wrong"})
        assert response.status_code == 401
    response = await client.post("/api/auth/login", json={"email": "nobody@x.test", "password": "wrong"})
    assert response.status_code == 429
    auth.failed_logins.clear()
