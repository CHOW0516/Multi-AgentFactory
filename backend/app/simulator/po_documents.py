"""Demo purchase-order PDFs in five customer layouts, some with realistic mistakes.

The mistakes test the Order agent's field check: wrong revision, a quantity or price that differs
from the quotation, and an unclear date. `DemoPurchaseOrder.mistakes` lists what was changed.
"""

import io
import random
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

LAYOUTS = ("classic_table", "letter", "compact", "two_column", "faxed")
MISTAKES = ("wrong_revision", "quantity_differs", "price_differs", "unclear_date")


@dataclass
class DemoPurchaseOrder:
    customer_name: str
    customer_code: str
    customer_address: str
    po_number: str
    part_number: str
    revision: str
    description: str
    quantity: int
    unit_price: Decimal
    due_date: date
    layout: str
    currency: str = "MYR"
    due_date_text: str = ""
    mistakes: list[str] = field(default_factory=list)

    @property
    def total(self) -> Decimal:
        return (self.unit_price * self.quantity).quantize(Decimal("0.01"))


def make_purchase_order(
    randomizer: random.Random,
    customer_name: str,
    customer_code: str,
    customer_address: str,
    part_number: str,
    revision: str,
    description: str,
    quantity: int,
    unit_price: Decimal,
    due_date: date,
    currency: str = "MYR",
    mistake_chance: float = 0.35,
) -> DemoPurchaseOrder:
    """Builds the PO data. With `mistake_chance`, one realistic mistake is added."""
    order = DemoPurchaseOrder(
        customer_name=customer_name,
        customer_code=customer_code,
        customer_address=customer_address,
        po_number=f"{customer_code}-PO-{randomizer.randint(10000, 99999)}",
        part_number=part_number,
        revision=revision,
        description=description,
        quantity=quantity,
        unit_price=unit_price,
        due_date=due_date,
        layout=randomizer.choice(LAYOUTS),
        currency=currency,
    )
    order.due_date_text = order.due_date.strftime("%d %b %Y")
    if randomizer.random() < mistake_chance:
        mistake = randomizer.choice(MISTAKES)
        order.mistakes.append(mistake)
        if mistake == "wrong_revision":
            order.revision = chr(ord(order.revision[0]) + 1) if order.revision[0] < "Z" else "A"
        elif mistake == "quantity_differs":
            order.quantity = int(order.quantity * randomizer.choice([0.8, 1.2, 1.5]))
        elif mistake == "price_differs":
            order.unit_price = (order.unit_price * Decimal("0.9")).quantize(Decimal("0.01"))
        elif mistake == "unclear_date":
            order.due_date_text = order.due_date.strftime("%m/%d/%y")  # US order, easy to misread
    return order


def demo_extraction(order: DemoPurchaseOrder) -> dict:
    """What a perfect reader would extract from this PO, in the order agent's extraction format.
    In demo mode the simulator sends this with the email so demo POs cost no AI calls.
    An unclear (US-style) date gets low confidence, like a careful reader would give it."""

    def field(value, source=None, confidence=0.98):
        text = None if value is None else str(value)
        return {"value": text, "confidence": confidence, "source_text": source or text}

    return {
        "customer_name": field(order.customer_name),
        "po_number": field(order.po_number),
        "po_revision": field(None),
        "due_date": field(
            order.due_date.isoformat(),
            order.due_date_text,
            0.6 if "unclear_date" in order.mistakes else 0.98,
        ),
        "delivery_address": field(order.customer_address or None),
        "notes": field(None),
        "lines": [
            {
                "part_number": field(order.part_number),
                "revision": field(order.revision),
                "quantity": field(order.quantity),
                "unit_price": field(f"{order.unit_price:.2f}"),
            }
        ],
    }


def render_pdf(order: DemoPurchaseOrder) -> bytes:
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer, pagesize=A4)
    page.setTitle(f"Purchase Order {order.po_number}")
    renderer = {
        "classic_table": _classic_table,
        "letter": _letter,
        "compact": _compact,
        "two_column": _two_column,
        "faxed": _faxed,
    }[order.layout]
    renderer(page, order)
    page.showPage()
    page.save()
    return buffer.getvalue()


def _money(order: DemoPurchaseOrder, value: Decimal) -> str:
    return f"{order.currency} {value:,.2f}"


def _classic_table(page: canvas.Canvas, order: DemoPurchaseOrder) -> None:
    width, height = A4
    page.setFont("Helvetica-Bold", 18)
    page.drawString(20 * mm, height - 25 * mm, order.customer_name)
    page.setFont("Helvetica", 9)
    page.drawString(20 * mm, height - 31 * mm, order.customer_address)
    page.setFont("Helvetica-Bold", 14)
    page.drawRightString(width - 20 * mm, height - 25 * mm, "PURCHASE ORDER")
    page.setFont("Helvetica", 10)
    page.drawRightString(width - 20 * mm, height - 32 * mm, f"PO No: {order.po_number}")
    page.drawRightString(width - 20 * mm, height - 38 * mm, f"Required by: {order.due_date_text}")
    top = height - 60 * mm
    headers = ["Item", "Part No.", "Rev", "Description", "Qty", "Unit price", "Amount"]
    columns = [20, 32, 70, 82, 130, 150, 175]
    page.setFillColor(colors.HexColor("#e8e8e8"))
    page.rect(18 * mm, top - 2 * mm, width - 36 * mm, 8 * mm, fill=1, stroke=0)
    page.setFillColor(colors.black)
    page.setFont("Helvetica-Bold", 9)
    for header, column in zip(headers, columns, strict=True):
        page.drawString(column * mm, top, header)
    page.setFont("Helvetica", 9)
    row = top - 9 * mm
    values = [
        "1",
        order.part_number,
        order.revision,
        order.description[:28],
        str(order.quantity),
        f"{order.unit_price:,.2f}",
        f"{order.total:,.2f}",
    ]
    for value, column in zip(values, columns, strict=True):
        page.drawString(column * mm, row, value)
    page.setFont("Helvetica-Bold", 10)
    page.drawRightString(width - 20 * mm, row - 15 * mm, f"Total: {_money(order, order.total)}")
    page.setFont("Helvetica", 8)
    page.drawString(
        20 * mm, 30 * mm, "Please confirm delivery date by return email. Deliver to the address above."
    )


def _letter(page: canvas.Canvas, order: DemoPurchaseOrder) -> None:
    _, height = A4
    text = page.beginText(25 * mm, height - 30 * mm)
    text.setFont("Times-Roman", 12)
    lines = [
        order.customer_name,
        order.customer_address,
        "",
        f"Our reference: {order.po_number}",
        "",
        "Dear Sales Team,",
        "",
        f"Please accept this as our purchase order for {order.quantity} pcs of part {order.part_number}",
        f"revision {order.revision} ({order.description}), at {_money(order, order.unit_price)} per piece,",
        f"total {_money(order, order.total)}.",
        "",
        f"We need the goods delivered on or before {order.due_date_text}.",
        "",
        "Kindly acknowledge this order.",
        "",
        "Regards,",
        "Purchasing Department",
    ]
    for line in lines:
        text.textLine(line)
    page.drawText(text)


def _compact(page: canvas.Canvas, order: DemoPurchaseOrder) -> None:
    width, height = A4
    page.setFont("Courier-Bold", 11)
    page.drawString(15 * mm, height - 20 * mm, f"PO#{order.po_number}  {order.customer_code}")
    page.setFont("Courier", 9)
    fields = [
        ("VENDOR ITEM", f"{order.part_number}/{order.revision}"),
        ("DESC", order.description),
        ("QTY", f"{order.quantity} EA"),
        ("PRICE", f"{order.unit_price:.2f}"),
        ("EXT", f"{order.total:.2f} {order.currency}"),
        ("DUE", order.due_date_text),
        ("SHIP TO", order.customer_address),
    ]
    for index, (label, value) in enumerate(fields):
        page.drawString(15 * mm, height - (32 + index * 6) * mm, f"{label:<12}: {value}")
    page.line(15 * mm, height - 80 * mm, width - 15 * mm, height - 80 * mm)


def _two_column(page: canvas.Canvas, order: DemoPurchaseOrder) -> None:
    width, height = A4
    page.setFillColor(colors.HexColor("#1f3b70"))
    page.rect(0, height - 30 * mm, width, 30 * mm, fill=1, stroke=0)
    page.setFillColor(colors.white)
    page.setFont("Helvetica-Bold", 16)
    page.drawString(20 * mm, height - 18 * mm, f"{order.customer_name} - Purchase Order")
    page.setFillColor(colors.black)
    page.setFont("Helvetica", 10)
    left = [
        ("Order number", order.po_number),
        ("Delivery date", order.due_date_text),
        ("Deliver to", order.customer_address),
    ]
    right = [
        ("Part", order.part_number),
        ("Drawing rev.", order.revision),
        ("Quantity", str(order.quantity)),
        ("Price / pc", _money(order, order.unit_price)),
        ("Order value", _money(order, order.total)),
    ]
    for index, (label, value) in enumerate(left):
        page.drawString(20 * mm, height - (45 + index * 8) * mm, f"{label}:")
        page.drawString(50 * mm, height - (45 + index * 8) * mm, value[:40])
    for index, (label, value) in enumerate(right):
        page.drawString(115 * mm, height - (45 + index * 8) * mm, f"{label}:")
        page.drawString(145 * mm, height - (45 + index * 8) * mm, value)
    page.drawString(20 * mm, height - 95 * mm, f"Item: {order.description}")


def _faxed(page: canvas.Canvas, order: DemoPurchaseOrder) -> None:
    """Looks like a fax: slightly rotated, grey speckles, low-contrast text."""
    width, height = A4
    randomizer = random.Random(order.po_number)
    page.setFillColor(colors.HexColor("#fafafa"))
    page.rect(0, 0, width, height, fill=1, stroke=0)
    page.setFillColor(colors.HexColor("#c8c8c8"))
    for _ in range(400):
        page.circle(
            randomizer.uniform(0, width),
            randomizer.uniform(0, height),
            randomizer.uniform(0.2, 0.7),
            fill=1,
            stroke=0,
        )
    page.saveState()
    page.translate(width / 2, height / 2)
    page.rotate(1.2)
    page.translate(-width / 2, -height / 2)
    page.setFillColor(colors.HexColor("#333333"))
    page.setFont("Courier", 10)
    page.drawString(20 * mm, height - 15 * mm, f"FAX FROM {order.customer_code}  PAGE 1/1")
    page.setFont("Courier-Bold", 13)
    page.drawString(20 * mm, height - 30 * mm, "PURCHASE ORDER")
    page.setFont("Courier", 10)
    lines = [
        f"P.O.: {order.po_number}",
        f"Customer: {order.customer_name}",
        f"Part: {order.part_number}  Rev {order.revision}",
        f"Desc: {order.description}",
        f"Qty: {order.quantity}   U/P: {order.unit_price:.2f}   Total: {order.total:.2f}",
        f"Delivery: {order.due_date_text}",
        f"Ship to: {order.customer_address}",
    ]
    for index, line in enumerate(lines):
        page.drawString(20 * mm, height - (42 + index * 7) * mm, line)
    page.restoreState()
