"""Simulator runtime (demo mode only): makes the demo factory feel alive.

- Every SIM_PO_INTERVAL_SECONDS: emails a demo PO PDF to IMAP_USER through SMTP (GreenMail in dev).
- Every SIM_MACHINE_EVENT_INTERVAL_SECONDS: publishes event.machine.raw for machines
  (running + part counts while a locked slot is active, idle otherwise, and random breakdowns).
The simulator never writes business data itself; the agents react to its emails and events.
"""

import asyncio
import json
import logging
import random
import smtplib
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage

from sqlalchemy import and_, select

from app.agents.order.intake import DEMO_DATA_FILE
from app.core.config import settings
from app.core.db import session_scope
from app.messaging import publish_event
from app.models import Customer, Machine, Part, Quotation, ScheduleSlot
from app.simulator.po_documents import DemoPurchaseOrder, demo_extraction, make_purchase_order, render_pdf

logger = logging.getLogger(__name__)

BREAKDOWN_MINUTES = (20, 90)


# ---------------------------------------------------------------- purchase orders
async def build_demo_purchase_order(randomizer: random.Random) -> DemoPurchaseOrder | None:
    """Picks an open quotation (or any part when none) and turns it into a PO."""
    async with session_scope() as session:
        quotations = (await session.scalars(select(Quotation).where(Quotation.status == "open"))).all()
        if quotations:
            quotation = randomizer.choice(quotations)
            part = await session.get(Part, quotation.part_id)
            customer = await session.get(Customer, quotation.customer_id)
            quantity, unit_price = int(quotation.quantity), quotation.unit_price
            due_date = quotation.quoted_due_date or (datetime.now(UTC).date() + timedelta(days=21))
        else:
            parts = (await session.scalars(select(Part).where(Part.customer_id.is_not(None)))).all()
            if not parts:
                return None
            part = randomizer.choice(parts)
            customer = await session.get(Customer, part.customer_id)
            quantity, unit_price = randomizer.choice([200, 500, 1000]), Decimal("12.50")
            due_date = datetime.now(UTC).date() + timedelta(days=randomizer.randint(14, 35))
    return make_purchase_order(
        randomizer,
        customer.name,
        customer.code,
        customer.address or "",
        part.part_number,
        part.revision,
        part.description or part.part_number,
        quantity,
        unit_price,
        due_date,
        currency=settings.currency,
    )


def email_purchase_order(order: DemoPurchaseOrder, sender: str) -> str:
    """Sends the PO as a PDF attachment. Returns the Message-ID."""
    message = EmailMessage()
    message["From"] = sender
    message["To"] = settings.imap_user
    message["Subject"] = f"Purchase Order {order.po_number}"
    message["Message-ID"] = f"<{uuid.uuid4()}@{order.customer_code.lower()}.example>"
    message.set_content(
        f"Dear Sales,\n\nPlease find attached our purchase order {order.po_number}.\n\nRegards,\n{order.customer_name}"
    )
    message.add_attachment(
        render_pdf(order), maintype="application", subtype="pdf", filename=f"{order.po_number}.pdf"
    )
    if settings.sim_skip_ai:
        # The order agent uses these values instead of calling the AI (demo mode only).
        data = json.dumps(demo_extraction(order)).encode()
        message.add_attachment(data, maintype="application", subtype="json", filename=DEMO_DATA_FILE)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        smtp.send_message(message)
    return message["Message-ID"]


async def send_one_purchase_order(randomizer: random.Random) -> DemoPurchaseOrder | None:
    order = await build_demo_purchase_order(randomizer)
    if order is None:
        logger.warning("No parts in the database; run the seed first")
        return None
    sender = f"purchasing@{order.customer_code.lower()}.example"
    await asyncio.to_thread(email_purchase_order, order, sender)
    logger.info(
        "Sent demo PO %s (%s layout, mistakes: %s)", order.po_number, order.layout, order.mistakes or "none"
    )
    return order


# ---------------------------------------------------------------- machines
@dataclass
class MachineSimulation:
    """Remembers what the simulator last told the system, so it only publishes changes."""

    randomizer: random.Random
    last_status: dict[uuid.UUID, str] = field(default_factory=dict)
    last_count: dict[uuid.UUID, int] = field(default_factory=dict)
    broken_until: dict[uuid.UUID, datetime] = field(default_factory=dict)
    # Slots that got at least one count: slot id -> (machine id, quantity, end time). Used for the final count.
    counted_slots: dict[uuid.UUID, tuple[uuid.UUID, int, datetime]] = field(default_factory=dict)

    async def tick(self, now: datetime | None = None, interval_seconds: float | None = None) -> list[dict]:
        """One simulation step. Returns the events it published."""
        now = now or datetime.now(UTC)
        interval = interval_seconds or settings.sim_machine_event_interval_seconds
        breakdown_chance = settings.sim_breakdown_chance_per_hour * interval / 3600
        async with session_scope() as session:
            machines = (await session.scalars(select(Machine))).all()
            active_slots = (
                await session.scalars(
                    select(ScheduleSlot).where(
                        and_(
                            ScheduleSlot.status == "locked",
                            ScheduleSlot.start_at <= now,
                            ScheduleSlot.end_at > now,
                        )
                    )
                )
            ).all()
        slot_by_machine = {slot.machine_id: slot for slot in active_slots}

        published = await self._publish_final_counts({slot.id for slot in active_slots}, now)
        for machine in machines:
            if machine.id in self.broken_until:
                if now < self.broken_until[machine.id]:
                    continue
                del self.broken_until[machine.id]
                self.last_status.pop(machine.id, None)  # force a fresh status after repair
            slot = slot_by_machine.get(machine.id)
            if slot is not None and self.randomizer.random() < breakdown_chance:
                minutes = self.randomizer.randint(*BREAKDOWN_MINUTES)
                self.broken_until[machine.id] = now + timedelta(minutes=minutes)
                published.append(await self._publish(machine.id, "status", "down", now))
                self.last_status[machine.id] = "down"
                logger.info("Simulated breakdown on %s for %s minutes", machine.code, minutes)
                continue
            status = "running" if slot is not None else "idle"
            if self.last_status.get(machine.id) != status:
                published.append(await self._publish(machine.id, "status", status, now))
                self.last_status[machine.id] = status
            if slot is not None:
                count = self._expected_count(slot, now)
                if count != self.last_count.get(slot.id):
                    published.append(await self._publish(machine.id, "count", str(count), now))
                    self.last_count[slot.id] = count
                    self.counted_slots[slot.id] = (machine.id, int(slot.quantity), slot.end_at)
        return published

    async def _publish_final_counts(self, active_slot_ids: set[uuid.UUID], now: datetime) -> list[dict]:
        """When a slot we were counting reaches its end, send its full quantity once.
        Progress counts carry noise and are rounded down, so without this a finished slot never reaches its quantity.
        A slot that stopped early (cancelled or moved) or whose machine is broken gets no final count."""
        published = []
        for slot_id, (machine_id, quantity, end_at) in list(self.counted_slots.items()):
            if slot_id in active_slot_ids:
                continue
            del self.counted_slots[slot_id]
            finished = now >= end_at and machine_id not in self.broken_until
            if finished and self.last_count.get(slot_id) != quantity:
                published.append(await self._publish(machine_id, "count", str(quantity), now))
            self.last_count.pop(slot_id, None)
        return published

    def _expected_count(self, slot: ScheduleSlot, now: datetime) -> int:
        """Parts made so far, assuming even progress over the slot with a little noise."""
        total_seconds = (slot.end_at - slot.start_at).total_seconds() or 1
        progress = min(max((now - slot.start_at).total_seconds() / total_seconds, 0), 1)
        noise = self.randomizer.uniform(0.95, 1.0)
        return int(Decimal(slot.quantity) * Decimal(str(progress * noise)))

    async def _publish(self, machine_id: uuid.UUID, kind: str, value: str, now: datetime) -> dict:
        data = {"machine_id": str(machine_id), "kind": kind, "value": value, "at": now.isoformat()}
        await publish_event("event.machine.raw", data, from_agent="simulator")
        return data


# ---------------------------------------------------------------- main loop
async def run_forever() -> None:
    randomizer = random.Random(settings.sim_random_seed)
    machines = MachineSimulation(randomizer)

    async def purchase_order_loop() -> None:
        if not settings.sim_send_pos:
            logger.info("SIM_SEND_POS=false: the simulator sends no demo POs")
            return
        while True:
            try:
                await send_one_purchase_order(randomizer)
            except Exception:
                logger.exception("Could not send a demo PO; will try again next interval")
            await asyncio.sleep(settings.sim_po_interval_seconds)

    async def machine_loop() -> None:
        while True:
            try:
                await machines.tick()
            except Exception:
                logger.exception("Machine simulation step failed; will try again next interval")
            await asyncio.sleep(settings.sim_machine_event_interval_seconds)

    logger.info(
        "Simulator running: a PO every %ss, machine events every %ss",
        settings.sim_po_interval_seconds,
        settings.sim_machine_event_interval_seconds,
    )
    await asyncio.gather(purchase_order_loop(), machine_loop())
