import json
import os
from datetime import date
from email.message import EmailMessage
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.agents.order import events, mail
from app.agents.order.customer import close_order, draft_customer_reply
from app.agents.order.extraction import extract_document
from app.agents.order.intake import Attachment, store_documents
from app.core.config import settings
from app.models import (
    AuditLog,
    CustomerMessage,
    ExtractedField,
    Order,
    OrderLine,
    PlanOption,
    Quotation,
    SourceDocument,
)

FIXTURES = Path(__file__).parent / "fixtures" / "pos"
FILES = sorted(path for path in FIXTURES.iterdir() if path.suffix in {".pdf", ".png", ".docx", ".xlsx"})


def field(value, confidence=0.98):
    return {"value": value, "confidence": confidence, "source_text": value}


def extraction(po="PO-100", *, customer="ACME", part="PX-14", quantity="10", price="25.00", confidence=0.98):
    return {
        "customer_name": field(customer),
        "po_number": field(po),
        "po_revision": field("A"),
        "due_date": field("2027-02-12", confidence),
        "delivery_address": field("42 Industrial Way"),
        "notes": field(None),
        "lines": [
            {
                "part_number": field(part),
                "revision": field("A"),
                "quantity": field(quantity),
                "unit_price": field(price),
            }
        ],
    }


@pytest.mark.parametrize("fixture", FILES, ids=lambda path: path.name)
async def test_extract_fixture(fixture, catalog, fake_ai, fake_broker, db_session):
    fake_ai.add_response(text=json.dumps(extraction(customer=" acme ", part=" pX-14 ")))
    (order,) = await store_documents([Attachment(fixture.name, fixture.read_bytes())])
    result = await extract_document(order.source_document_id)
    repeat = await extract_document(order.source_document_id)
    assert repeat == result
    assert not result.fields_needing_check and not result.quotation_mismatches
    assert len(fake_ai.requests) == 1
    req = fake_ai.requests[0]
    assert req["messages"][0]["role"] == "system"
    blocks = req["messages"][1]["content"]
    expected_type = {".pdf": "image_url", ".png": "image_url"}.get(fixture.suffix, "text")
    assert blocks[0]["type"] == expected_type
    if expected_type == "text":
        assert "PX-14" in blocks[0]["text"]
    assert req["response_format"]["json_schema"]["schema"]["additionalProperties"] is False
    saved = await db_session.get(Order, order.id)
    assert saved.customer_id == catalog.customer.id
    line = await db_session.scalar(select(OrderLine).where(OrderLine.order_id == order.id))
    assert line.part_id == catalog.part.id and line.quantity == 10
    fields = await db_session.scalars(select(ExtractedField).where(ExtractedField.order_id == order.id))
    assert len(fields.all()) == 10
    assert len(fake_broker.published_to("event.order.received")) == 1


async def test_confidence_quotation_and_revised_po(catalog, make_order, fake_ai, fake_broker, db_session):
    original = await make_order(status="CONFIRMED", po_number="PO-100", due_date=date(2027, 2, 12))
    db_session.add(
        Quotation(
            quote_number="QT-10",
            customer_id=catalog.customer.id,
            part_id=catalog.part.id,
            unit_price=25,
            quantity=10,
            quoted_due_date=date(2027, 2, 12),
            status="open",
        )
    )
    await db_session.commit()
    fake_ai.add_response(text=json.dumps(extraction(quantity="11", price="26.00", confidence=0.3)))
    (order,) = await store_documents([Attachment(FILES[0].name, FILES[0].read_bytes())])
    result = await extract_document(order.source_document_id)
    assert set(result.fields_needing_check) == {"due_date", "lines[0].quantity", "lines[0].unit_price"}
    assert {row.field for row in result.quotation_mismatches} == {"lines[0].quantity", "lines[0].unit_price"}
    saved = await db_session.get(Order, order.id)
    assert saved.previous_order_id == original.id
    assert len(fake_broker.published_to("event.order.revised")) == 1


async def test_sales_can_correct_an_unmatched_part(
    catalog, fake_ai, db_session, client, auth_headers, fake_broker
):
    fake_ai.add_response(text=json.dumps(extraction(part="UNKNOWN")))
    (order,) = await store_documents([Attachment(FILES[0].name, FILES[0].read_bytes())])
    result = await extract_document(order.source_document_id)
    assert "lines[0].part_number" in result.fields_needing_check
    saved = await db_session.get(Order, order.id)
    saved.status = "NEEDS_FIELD_CHECK"
    await db_session.commit()

    endpoint = f"/api/orders/{order.id}/fields"
    sales = auth_headers("sales")
    fields = (await client.get(endpoint, headers=sales)).json()
    part_field = next(field for field in fields if field["field_name"] == "lines[0].part_number")
    assert (await client.post(endpoint + "/confirm", headers=sales)).status_code == 422
    edit = await client.patch(
        endpoint,
        headers=sales,
        json=[
            {"field_id": part_field["id"], "corrected_value": "PX-14"},
        ],
    )
    assert edit.status_code == 200, edit.text
    confirmed = await client.post(endpoint + "/confirm", headers=sales)
    assert confirmed.status_code == 200, confirmed.text
    assert len(fake_broker.published_to("event.order.fields_corrected")) == 1
    line = await db_session.scalar(select(OrderLine).where(OrderLine.order_id == order.id))
    assert line.part_id == catalog.part.id


class Mailbox:
    def __init__(self, raw):
        self.raw = raw
        self.seen = []

    def uid(self, command, *args):
        if command == "SEARCH":
            return "OK", [b"1 2"]
        if command == "FETCH":
            assert args[1] == "(BODY.PEEK[])"
            return "OK", [(b"metadata", self.raw)]
        self.seen.append(args[0])
        return "OK", [b""]

    def logout(self):
        return "BYE", []


def sample_email():
    message = EmailMessage()
    message["Message-ID"] = "<p2-order@example.test>"
    message["From"] = "orders@example.test"
    message["Subject"] = "Purchase order"
    message.set_content("Please see the attached order.")
    message.add_attachment(
        FILES[0].read_bytes(), maintype="application", subtype="pdf", filename=FILES[0].name
    )
    return message.as_bytes()


async def test_imap_skips_duplicate_message_id(catalog, monkeypatch, db_session, fake_broker):
    mailbox = Mailbox(sample_email())
    monkeypatch.setattr(mail, "open_mailbox", lambda: mailbox)
    await mail.poll_once()
    assert mailbox.seen == [b"1", b"2"]
    assert await db_session.scalar(select(func.count()).select_from(SourceDocument)) == 1
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert len(fake_broker.published_to("event.order.received")) == 1


async def test_email_retries_after_commit_without_a_second_order(
    catalog, monkeypatch, db_session, fake_broker
):
    metadata, files, _ = mail.message_parts(sample_email())
    real_publish = events.publish_event

    async def unavailable(*args, **kwargs):
        raise RuntimeError("temporarily unavailable")

    monkeypatch.setattr(events, "publish_event", unavailable)
    with pytest.raises(RuntimeError, match="temporarily unavailable"):
        await store_documents(files, email=metadata)
    monkeypatch.setattr(events, "publish_event", real_publish)
    await store_documents(files, email=metadata)
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 1
    assert len(fake_broker.published_to("event.order.received")) == 1


async def test_split_draft_and_close_use_database_facts(
    catalog, make_order, db_session, fake_ai, fake_broker
):
    order = await make_order(quantity=10, status="CONFIRMED", po_number="PO-101")
    proposal = PlanOption(
        order_id=order.id,
        option_type="split",
        finish_date=date(2027, 2, 12),
        split_quantity_first=6,
        split_finish_date_first=date(2027, 2, 10),
    )
    db_session.add(proposal)
    await db_session.flush()
    fake_ai.add_response(text="Thank you for your order.")
    drafted = await draft_customer_reply(db_session, order.id, proposal.id)
    saved = await db_session.get(CustomerMessage, drafted.customer_message_id)
    assert saved.status == "draft"
    assert "6 by 10 February 2027" in saved.draft_text
    assert "4 by 12 February 2027" in saved.draft_text
    assert await draft_customer_reply(db_session, order.id, proposal.id) == drafted
    await close_order(db_session, order.id)
    await db_session.flush()
    assert order.status == "COMPLETED"
    assert await db_session.scalar(select(AuditLog.id).where(AuditLog.action == "close_order")) is not None


async def test_upload_recovers_a_pending_event(client, auth_headers, catalog, monkeypatch, fake_broker):
    real_publish = events.publish_event

    async def unavailable(*args, **kwargs):
        raise RuntimeError("broker is unavailable")

    monkeypatch.setattr(events, "publish_event", unavailable)
    path = FILES[0]
    received = await client.post(
        "/api/orders/upload",
        headers=auth_headers("sales"),
        files={
            "file": (path.name, path.read_bytes(), "application/pdf"),
        },
    )
    assert received.status_code == 201, received.text
    assert not fake_broker.published_to("event.order.received")
    monkeypatch.setattr(events, "publish_event", real_publish)
    await events.flush_events(retry=True)
    await events.flush_events(retry=True)
    assert len(fake_broker.published_to("event.order.received")) == 1


@pytest.mark.skipif(os.environ.get("RUN_LIVE_LLM_TESTS") != "1", reason="live AI provider is opt-in")
async def test_live_ai_extraction(catalog):
    if not settings.ai_api_key or settings.ai_api_key == "test-key":
        pytest.skip("AI_API_KEY is required")
    (order,) = await store_documents([Attachment(FILES[0].name, FILES[0].read_bytes())])
    result = await extract_document(order.source_document_id)
    assert result.order_id == order.id
    assert "lines[0].part_number" not in result.fields_needing_check
