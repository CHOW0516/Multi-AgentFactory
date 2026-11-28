"""Simulator runtime: demo PO PDFs, mistakes, machine events and breakdowns."""

import email
import imaplib
import json
import random
import socket
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, update

from app.core.config import settings
from app.models import Customer, Machine, Order, Part, Quotation, ScheduleSlot
from app.simulator import runtime
from app.simulator.po_documents import LAYOUTS, MISTAKES, make_purchase_order, render_pdf
from app.simulator.seed import seed


def _order(randomizer, mistake_chance=0.0):
    return make_purchase_order(
        randomizer,
        "Acme Sdn Bhd",
        "ACME",
        "1 Jalan Test",
        "AC-100",
        "B",
        "Bracket",
        500,
        Decimal("12.50"),
        date(2026, 12, 20),
        mistake_chance=mistake_chance,
    )


def test_every_layout_renders_a_pdf():
    for layout in LAYOUTS:
        order = _order(random.Random(1))
        order.layout = layout
        pdf_bytes = render_pdf(order)
        assert pdf_bytes.startswith(b"%PDF"), layout
        assert len(pdf_bytes) > 1000, layout


def test_no_mistake_keeps_the_quotation_values():
    order = _order(random.Random(3), mistake_chance=0.0)
    assert order.mistakes == []
    assert (order.revision, order.quantity, order.unit_price) == ("B", 500, Decimal("12.50"))
    assert order.due_date_text == "20 Dec 2026"


def test_each_mistake_changes_the_right_field():
    seen = set()
    for seed_number in range(200):
        order = _order(random.Random(seed_number), mistake_chance=1.0)
        assert len(order.mistakes) == 1
        mistake = order.mistakes[0]
        seen.add(mistake)
        if mistake == "wrong_revision":
            assert order.revision != "B"
        elif mistake == "quantity_differs":
            assert order.quantity != 500
        elif mistake == "price_differs":
            assert order.unit_price != Decimal("12.50")
        elif mistake == "unclear_date":
            assert order.due_date_text == "12/20/26"
    assert seen == set(MISTAKES)


async def _seeded_machine_with_slot(db_session, now, hours_left=1):
    await seed(reset=True)
    machine = (await db_session.scalars(select(Machine).order_by(Machine.code))).first()
    order = (await db_session.scalars(select(Order))).first()
    slot = ScheduleSlot(
        order_id=order.id,
        machine_id=machine.id,
        routing_step=1,
        quantity=Decimal(100),
        start_at=now - timedelta(hours=1),
        end_at=now + timedelta(hours=hours_left),
        status="locked",
    )
    db_session.add(slot)
    await db_session.commit()
    return machine


def _events_for(fake_broker, machine):
    events = []
    for delivery in fake_broker.published_to("event.machine.raw"):
        payload = json.loads(delivery.body)["payload"]
        if payload["machine_id"] == str(machine.id):
            events.append((payload["kind"], payload["value"]))
    return events


async def test_machine_tick_publishes_running_count_and_idle(db_session, fake_broker, monkeypatch):
    monkeypatch.setattr(settings, "sim_energy", False)  # power readings are tested in test_energy_alerts
    monkeypatch.setattr(settings, "sim_breakdown_chance_per_hour", 0.0)
    now = datetime.now(UTC)
    machine = await _seeded_machine_with_slot(db_session, now)
    simulation = runtime.MachineSimulation(random.Random(7))

    await simulation.tick(now, 20)
    first = _events_for(fake_broker, machine)
    assert first[0] == ("status", "running")
    assert first[1][0] == "count" and 45 <= int(first[1][1]) <= 50  # half way through 100 pcs

    # Same moment again: nothing new for this machine (only changes are published).
    fake_broker.published.clear()
    await simulation.tick(now, 20)
    assert ("status", "running") not in _events_for(fake_broker, machine)

    # After the slot ends it sends the full quantity once, then the machine goes idle.
    fake_broker.published.clear()
    await simulation.tick(now + timedelta(hours=2), 20)
    assert _events_for(fake_broker, machine) == [("count", "100"), ("status", "idle")]

    fake_broker.published.clear()
    await simulation.tick(now + timedelta(hours=3), 20)
    assert _events_for(fake_broker, machine) == []


async def test_no_final_count_when_slot_stops_early(db_session, fake_broker, monkeypatch):
    monkeypatch.setattr(settings, "sim_energy", False)  # power readings are tested in test_energy_alerts
    from sqlalchemy import update

    from app.models import ScheduleSlot

    monkeypatch.setattr(settings, "sim_breakdown_chance_per_hour", 0.0)
    now = datetime.now(UTC)
    machine = await _seeded_machine_with_slot(db_session, now)
    simulation = runtime.MachineSimulation(random.Random(7))
    await simulation.tick(now, 20)

    # The slot is moved back to tentative (for example by a replan) before it ends.
    await db_session.execute(update(ScheduleSlot).values(status="tentative"))
    await db_session.commit()
    fake_broker.published.clear()
    await simulation.tick(now + timedelta(minutes=1), 20)
    assert _events_for(fake_broker, machine) == [("status", "idle")]


async def test_breakdown_then_recovery(db_session, fake_broker, monkeypatch):
    monkeypatch.setattr(settings, "sim_energy", False)  # power readings are tested in test_energy_alerts
    now = datetime.now(UTC)
    machine = await _seeded_machine_with_slot(db_session, now, hours_left=3)
    simulation = runtime.MachineSimulation(random.Random(7))

    monkeypatch.setattr(settings, "sim_breakdown_chance_per_hour", 1e9)  # always breaks
    await simulation.tick(now, 20)
    assert _events_for(fake_broker, machine) == [("status", "down")]

    monkeypatch.setattr(settings, "sim_breakdown_chance_per_hour", 0.0)
    fake_broker.published.clear()
    await simulation.tick(now + timedelta(minutes=10), 20)  # still under repair
    assert _events_for(fake_broker, machine) == []

    fake_broker.published.clear()
    await simulation.tick(now + timedelta(minutes=95), 20)  # repaired, slot still active
    assert _events_for(fake_broker, machine)[0] == ("status", "running")


def _greenmail_reachable() -> bool:
    try:
        with socket.create_connection((settings.smtp_host, settings.smtp_port), timeout=1):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not _greenmail_reachable(), reason="GreenMail SMTP not reachable")
async def test_demo_po_arrives_in_the_orders_mailbox(db_session):
    await seed(reset=True)
    order = await runtime.send_one_purchase_order(random.Random(11))
    assert order is not None

    mailbox = imaplib.IMAP4(settings.imap_host, settings.imap_port)
    mailbox.login(settings.imap_user, settings.imap_password)
    mailbox.select("INBOX")
    _, found = mailbox.search(None, f'SUBJECT "{order.po_number}"')
    message_numbers = found[0].split()
    assert message_numbers, "PO email not found"
    _, data = mailbox.fetch(message_numbers[-1], "(RFC822)")
    mailbox.logout()
    message = email.message_from_bytes(data[0][1])
    attachments = [part for part in message.walk() if part.get_content_type() == "application/pdf"]
    assert attachments and attachments[0].get_payload(decode=True).startswith(b"%PDF")


async def test_demo_po_uses_an_open_quotation(db_session):
    await seed(reset=True)
    order = await runtime.build_demo_purchase_order(random.Random(5))
    quoted_pairs = set(
        (
            await db_session.execute(
                select(Part.part_number, Customer.code)
                .join(Quotation, Quotation.part_id == Part.id)
                .join(Customer, Customer.id == Quotation.customer_id)
                .where(Quotation.status == "open")
            )
        ).all()
    )
    assert (order.part_number, order.customer_code) in quoted_pairs


async def test_demo_po_falls_back_to_a_customer_part_without_open_quotations(db_session):
    await seed(reset=True)
    await db_session.execute(update(Quotation).values(status="expired"))
    await db_session.commit()
    order = await runtime.build_demo_purchase_order(random.Random(5))
    assert order is not None and order.quantity > 0


async def test_send_po_with_empty_database_returns_none(db_session, monkeypatch):
    def fail_if_called(*arguments):
        raise AssertionError("must not send email without data")

    monkeypatch.setattr(runtime, "email_purchase_order", fail_if_called)
    assert await runtime.send_one_purchase_order(random.Random(5)) is None
