"""Test purchase-order PDFs: clean, messy, missing fields, wrong values, rush dates, unknown items, duplicates.

Run after the scenarios seed (it reads real customers, parts, quotations and the seeded test orders):
    python -m app.simulator test-pos --out ./test-pos
Each file is listed in README.md in the same folder with what the app should do with it.
Upload the files on the Orders page (or email them to the orders inbox).
"""

import io
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy import select

from app.core.config import settings
from app.core.db import session_scope
from app.models import Customer, Holiday, Order, OrderLine, Part, Quotation, Routing
from app.simulator.po_documents import DemoPurchaseOrder, render_pdf


@dataclass
class Line:
    part_number: str
    revision: str | None
    description: str
    quantity: int
    unit_price: Decimal | None


@dataclass
class TestPo:
    """A PO for the generic renderer. None (or empty) means the field is left blank on the PDF."""

    customer_name: str
    customer_address: str
    po_number: str | None
    due_date_text: str | None
    lines: list[Line]
    po_revision: str | None = None
    note: str | None = None
    currency: str = "MYR"


@dataclass
class TestFile:
    file_name: str
    content: bytes
    tests: str
    expected: str
    details: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- rendering
def render_test_po(po: TestPo) -> bytes:
    """A plain table PO that supports several lines and blank fields."""
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    page.setTitle(f"Purchase Order {po.po_number or ''}")
    page.setFont("Helvetica-Bold", 17)
    page.drawString(20 * mm, height - 25 * mm, po.customer_name)
    page.setFont("Helvetica", 9)
    page.drawString(20 * mm, height - 31 * mm, po.customer_address)
    page.setFont("Helvetica-Bold", 14)
    page.drawRightString(width - 20 * mm, height - 25 * mm, "PURCHASE ORDER")
    page.setFont("Helvetica", 10)
    page.drawRightString(width - 20 * mm, height - 32 * mm, f"PO No: {po.po_number or ''}")
    if po.po_revision:
        page.drawRightString(width - 20 * mm, height - 38 * mm, f"PO Revision: {po.po_revision}")
    page.drawRightString(width - 20 * mm, height - 44 * mm, f"Required by: {po.due_date_text or ''}")

    top = height - 65 * mm
    headers = ["Item", "Part No.", "Rev", "Description", "Qty", "Unit price", "Amount"]
    columns = [20, 32, 70, 82, 130, 150, 175]
    page.setFillColor(colors.HexColor("#e8e8e8"))
    page.rect(18 * mm, top - 2 * mm, width - 36 * mm, 8 * mm, fill=1, stroke=0)
    page.setFillColor(colors.black)
    page.setFont("Helvetica-Bold", 9)
    for header, column in zip(headers, columns, strict=True):
        page.drawString(column * mm, top, header)
    page.setFont("Helvetica", 9)
    total = Decimal(0)
    row = top
    for number, line in enumerate(po.lines, start=1):
        row -= 9 * mm
        amount = line.unit_price * line.quantity if line.unit_price is not None else None
        total += amount or 0
        values = [
            str(number),
            line.part_number,
            line.revision or "",
            line.description[:28],
            f"{line.quantity:,}",
            f"{line.unit_price:,.2f}" if line.unit_price is not None else "",
            f"{amount:,.2f}" if amount is not None else "",
        ]
        for value, column in zip(values, columns, strict=True):
            page.drawString(column * mm, row, value)
    page.setFont("Helvetica-Bold", 10)
    page.drawRightString(width - 20 * mm, row - 15 * mm, f"Total: {po.currency} {total:,.2f}")
    page.setFont("Helvetica", 9)
    if po.note:
        page.drawString(20 * mm, row - 30 * mm, f"Note: {po.note}")
    page.setFont("Helvetica", 8)
    page.drawString(20 * mm, 30 * mm, "Please confirm delivery date by return email.")
    page.showPage()
    page.save()
    return buffer.getvalue()


def render_free_text(po: TestPo) -> bytes:
    """A messy email-style PO: everything is inside sentences, no table."""
    buffer = io.BytesIO()
    page = canvas.Canvas(buffer, pagesize=A4)
    _, height = A4
    line = po.lines[0]
    text = page.beginText(22 * mm, height - 28 * mm)
    text.setFont("Helvetica", 11)
    for sentence in [
        f"From: purchasing, {po.customer_name}",
        "Subject: urgent order pls",
        "",
        "hi team,",
        "",
        "as discussed on the phone with your sales, pls go ahead with the parts below.",
        f"we need {line.quantity:,} pcs of {line.part_number} (rev {line.revision}) - the {line.description.lower()}.",
        f"price same as your quote, {po.currency} {line.unit_price} each.",
        f"our ref no is {po.po_number}. delivery latest by {po.due_date_text}, earlier also ok.",
        "send to our usual address.",
        "",
        "tq & regards",
        "purchasing dept",
    ]:
        text.textLine(sentence)
    page.drawText(text)
    page.showPage()
    page.save()
    return buffer.getvalue()


# ---------------------------------------------------------------- data
async def _quoted_parts(session) -> list[tuple[Part, Quotation, Customer]]:
    """Open quotations whose part is not already used by a seeded test order."""
    scenario_parts = (
        select(OrderLine.part_id)
        .join(Order)
        .where(Order.order_number.like("%-T%"))
        .where(OrderLine.part_id.is_not(None))
    )
    rows = await session.execute(
        select(Part, Quotation, Customer)
        .join(Quotation, Quotation.part_id == Part.id)
        .join(Customer, Customer.id == Quotation.customer_id)
        .where(Quotation.status == "open", Part.id.not_in(scenario_parts))
        .order_by(Quotation.quote_number)
    )
    return list(rows.tuples())


async def _scenario_order(session, number_suffix: str) -> tuple[Order, OrderLine, Part, Customer] | None:
    order = await session.scalar(select(Order).where(Order.order_number.like(f"%-{number_suffix}")))
    if order is None:
        return None
    line = await session.scalar(select(OrderLine).where(OrderLine.order_id == order.id))
    part = await session.get(Part, line.part_id)
    customer = await session.get(Customer, order.customer_id)
    return order, line, part, customer


async def _lathe_only_parts(session) -> list[tuple[Part, Customer]]:
    result = []
    for part, customer in (
        await session.execute(select(Part, Customer).join(Customer).order_by(Part.part_number))
    ).tuples():
        types = set(await session.scalars(select(Routing.machine_type).where(Routing.part_id == part.id)))
        if "cnc_lathe" in types and "cnc_mill" not in types:
            result.append((part, customer))
    return result


def _working_day(start: date, days_ahead: int) -> date:
    day = start
    while days_ahead > 0:
        day += timedelta(days=1)
        if day.weekday() < 5:
            days_ahead -= 1
    return day


def _line(part: Part, quantity: int, price: Decimal | None, revision: str | None = "same") -> Line:
    return Line(
        part.part_number,
        part.revision if revision == "same" else revision,
        part.description or part.part_number,
        quantity,
        price,
    )


def _demo(part: Part, quote: Quotation, customer: Customer, po_number: str, layout: str) -> DemoPurchaseOrder:
    return DemoPurchaseOrder(
        customer_name=customer.name,
        customer_code=customer.code,
        customer_address=customer.address or "",
        po_number=po_number,
        part_number=part.part_number,
        revision=part.revision,
        description=part.description or part.part_number,
        quantity=int(quote.quantity),
        unit_price=quote.unit_price,
        due_date=quote.quoted_due_date,
        layout=layout,
        currency=settings.currency,
        due_date_text=quote.quoted_due_date.strftime("%d %b %Y"),
    )


async def build_test_files() -> list[TestFile]:
    today = datetime.now(UTC).astimezone(ZoneInfo(settings.app_timezone)).date()
    stamp = today.strftime("%m%d")
    files: list[TestFile] = []

    def po_number(customer: Customer, number: int) -> str:
        return f"{customer.code}-QA{stamp}-{number:02d}"

    async with session_scope() as session:
        quoted = await _quoted_parts(session)
        if len(quoted) < 11:
            raise RuntimeError(
                "Not enough open quotations. Run: python -m app.simulator seed --reset --scenarios"
            )
        quoted_iter = iter(quoted)

        def next_quoted():
            return next(quoted_iter)

        def table(customer: Customer, number: int, due: str | None, lines: list[Line], **extra) -> TestPo:
            return TestPo(
                customer.name,
                customer.address or "",
                po_number(customer, number),
                due,
                lines,
                currency=settings.currency,
                **extra,
            )

        def add(name, content, tests, expected, *details):
            files.append(TestFile(name, content, tests, expected, list(details)))

        # ---- clean
        for number, (layout, label) in enumerate(
            [("classic_table", "table"), ("letter", "letter"), ("two_column", "two-column")], start=1
        ):
            part, quote, customer = next_quoted()
            add(
                f"{number:02d}-clean-{label}.pdf",
                render_pdf(_demo(part, quote, customer, po_number(customer, number), layout)),
                f"Clean PO in the {label} layout. Matches quotation {quote.quote_number} exactly.",
                "Extracted with no fields to check, then material check, planning, and an approval card.",
                f"{customer.name}, {part.part_number} rev {part.revision}, {int(quote.quantity)} pcs at "
                f"{quote.unit_price}, due {quote.quoted_due_date}",
            )

        # ---- messy
        part, quote, customer = next_quoted()
        add(
            "04-messy-fax-scan.pdf",
            render_pdf(_demo(part, quote, customer, po_number(customer, 4), "faxed")),
            "Faxed look: tilted, speckled, low contrast. Values match the quotation.",
            "Extracted correctly, maybe with lower confidence on some fields (then a field check).",
        )
        part, quote, customer = next_quoted()
        free = table(
            customer,
            5,
            quote.quoted_due_date.strftime("%d/%m/%Y"),
            [_line(part, int(quote.quantity), quote.unit_price)],
        )
        add(
            "05-messy-free-text-email.pdf",
            render_free_text(free),
            "Informal email-style PO with no table; all values are inside sentences.",
            "Extracted correctly. Delivery address is missing (it says 'usual address').",
        )

        # ---- missing fields
        part, quote, customer = next_quoted()
        add(
            "06-missing-due-date.pdf",
            render_test_po(table(customer, 6, None, [_line(part, int(quote.quantity), quote.unit_price)])),
            "No delivery date on the PO.",
            "NEEDS_FIELD_CHECK: 'An ISO delivery date is required'. Sales must type a date to continue.",
        )
        part, quote, customer = next_quoted()
        po = table(
            customer,
            7,
            quote.quoted_due_date.strftime("%d %b %Y"),
            [_line(part, int(quote.quantity), quote.unit_price)],
        )
        po.po_number = None
        add(
            "07-missing-po-number.pdf",
            render_test_po(po),
            "No PO number.",
            "NEEDS_FIELD_CHECK: 'PO number is required'.",
        )
        part, quote, customer = next_quoted()
        add(
            "08-missing-revision-and-price.pdf",
            render_test_po(
                table(
                    customer,
                    8,
                    quote.quoted_due_date.strftime("%d %b %Y"),
                    [_line(part, int(quote.quantity), None, None)],
                )
            ),
            "Revision and unit price are blank.",
            "NEEDS_FIELD_CHECK on revision and price (they differ from the quotation).",
        )

        # ---- wrong values vs quotation
        part, quote, customer = next_quoted()
        wrong = chr(ord(part.revision[0]) + 1)
        add(
            "09-wrong-revision.pdf",
            render_test_po(
                table(
                    customer,
                    9,
                    quote.quoted_due_date.strftime("%d %b %Y"),
                    [_line(part, int(quote.quantity), quote.unit_price, wrong)],
                )
            ),
            f"Revision {wrong} on the PO, but master data and the quotation say {part.revision}.",
            "NEEDS_FIELD_CHECK: 'Revision differs from master data'.",
        )
        part, quote, customer = next_quoted()
        low = (quote.unit_price * Decimal("0.85")).quantize(Decimal("0.01"))
        add(
            "10-price-below-quote.pdf",
            render_test_po(
                table(
                    customer,
                    10,
                    quote.quoted_due_date.strftime("%d %b %Y"),
                    [_line(part, int(quote.quantity), low)],
                )
            ),
            f"Unit price {low}, quotation says {quote.unit_price} (15% lower).",
            "NEEDS_FIELD_CHECK: price differs from the open quotation.",
        )
        part, quote, customer = next_quoted()
        more = int(quote.quantity * Decimal("1.5"))
        add(
            "11-quantity-differs.pdf",
            render_test_po(
                table(
                    customer,
                    11,
                    quote.quoted_due_date.strftime("%d %b %Y"),
                    [_line(part, more, quote.unit_price)],
                )
            ),
            f"Quantity {more}, quotation says {int(quote.quantity)}.",
            "NEEDS_FIELD_CHECK: quantity differs from the open quotation.",
        )
        part, quote, customer = next_quoted()
        ambiguous = date(today.year + 1, 3, 4)
        add(
            "12-unclear-date-us-format.pdf",
            render_test_po(
                table(
                    customer,
                    12,
                    ambiguous.strftime("%m/%d/%y"),
                    [_line(part, int(quote.quantity), quote.unit_price)],
                )
            ),
            "Date written 03/04/27: 4 March (US) or 3 April (Malaysia)?",
            "NEEDS_FIELD_CHECK on due_date (low confidence and/or differs from the quotation).",
        )

        # ---- dates that cannot be met
        lathe_parts = await _lathe_only_parts(session)
        part, customer = lathe_parts[0]
        rush_day = _working_day(today, 3)
        add(
            "13-rush-3-days.pdf",
            render_test_po(
                table(customer, 13, rush_day.strftime("%d %b %Y"), [_line(part, 2000, Decimal("16.00"))])
            ),
            f"2,000 pcs on the lathes, due in 3 working days ({rush_day}). Both lathes are busy with running orders.",
            "Planning cannot meet the date: approval card shows delay (and maybe overtime/split) options with a new date.",
        )
        part, customer = lathe_parts[1]
        holiday = await session.scalar(
            select(Holiday.holiday_date)
            .where(Holiday.holiday_date > today + timedelta(days=14))
            .order_by(Holiday.holiday_date)
            .limit(1)
        )
        add(
            "14-due-on-public-holiday.pdf",
            render_test_po(
                table(customer, 14, holiday.strftime("%d %b %Y"), [_line(part, 300, Decimal("14.00"))])
            ),
            f"Due on a public holiday ({holiday}).",
            "Planner must finish on a working day before it; no work is scheduled on the holiday.",
        )
        part, customer = lathe_parts[2]
        past = today - timedelta(days=2)
        add(
            "15-due-date-already-passed.pdf",
            render_test_po(
                table(customer, 15, past.strftime("%d %b %Y"), [_line(part, 200, Decimal("14.00"))])
            ),
            f"Due date {past} is in the past.",
            "Only a delay option is possible; the reply should propose a new date.",
        )
        part, customer = lathe_parts[3]
        add(
            "16-huge-quantity.pdf",
            render_test_po(
                table(
                    customer,
                    16,
                    _working_day(today, 15).strftime("%d %b %Y"),
                    [_line(part, 20000, Decimal("11.00"))],
                )
            ),
            "20,000 pcs: far more material than in stock and weeks of machine time.",
            "Material shortage (ready date from supplier lead time), long delay option, purchase request after approval.",
        )

        # ---- unknown items
        part, quote, customer = next_quoted()
        add(
            "17-unknown-part-number.pdf",
            render_test_po(
                table(
                    customer,
                    17,
                    _working_day(today, 15).strftime("%d %b %Y"),
                    [Line(f"{customer.code}-9999", "A", "New impeller housing", 400, Decimal("22.00"))],
                )
            ),
            f"Part {customer.code}-9999 is not in the catalog.",
            "NEEDS_FIELD_CHECK: 'Part could not be uniquely matched'. Order cannot continue until fixed.",
        )
        add(
            "18-unknown-customer.pdf",
            render_test_po(
                TestPo(
                    "Zenith Marine Engineering Sdn Bhd",
                    "12 Jalan Pelabuhan, Port Klang",
                    f"ZENITH-QA{stamp}-18",
                    _working_day(today, 15).strftime("%d %b %Y"),
                    [Line("ZM-4410", "A", "Propeller shaft sleeve", 150, Decimal("48.00"))],
                    currency=settings.currency,
                )
            ),
            "A customer that is not in the system.",
            "NEEDS_FIELD_CHECK: 'Customer could not be matched'.",
        )

        # ---- duplicates and revisions of seeded orders
        replied = await _scenario_order(session, "T010")
        if replied:
            order, line, part, customer = replied
            po = TestPo(
                customer.name,
                customer.address or "",
                order.po_number,
                order.due_date.strftime("%d %b %Y"),
                [_line(part, int(line.quantity), line.unit_price)],
                currency=settings.currency,
            )
            add(
                "19-duplicate-po.pdf",
                render_test_po(po),
                f"Exact copy of PO {order.po_number}, already confirmed as {order.order_number}.",
                "Linked to the earlier order as a repeat/revision. Check that it is not produced twice.",
            )
        drafted = await _scenario_order(session, "T009")
        if drafted:
            order, line, part, customer = drafted
            po = TestPo(
                customer.name,
                customer.address or "",
                order.po_number,
                order.due_date.strftime("%d %b %Y"),
                [_line(part, int(line.quantity * Decimal("1.5")), line.unit_price)],
                po_revision="2",
                note="Revision 2 replaces revision 1. Quantity increased.",
                currency=settings.currency,
            )
            add(
                "20-revised-po-rev2.pdf",
                render_test_po(po),
                f"Revision 2 of PO {order.po_number} ({order.order_number}), quantity +50%.",
                "Linked to the earlier order (previous order set); the old plan is replaced after approval.",
            )

        # ---- multi-line with a short material
        short = await _scenario_order(session, "T008")
        if short:
            _order, _line_row, short_part, customer = short
            others = list(
                await session.scalars(
                    select(Part)
                    .where(Part.customer_id == customer.id, Part.id != short_part.id)
                    .order_by(Part.part_number)
                    .limit(2)
                )
            )
            lines = [_line(short_part, 400, Decimal("26.00"))] + [
                _line(other, 250, Decimal("15.00")) for other in others
            ]
            add(
                "21-multi-line-with-short-material.pdf",
                render_test_po(table(customer, 21, _working_day(today, 12).strftime("%d %b %Y"), lines)),
                f"{len(lines)} lines. Line 1 ({short_part.part_number}) uses a material that is almost out of stock.",
                "All lines extracted; material check shows the shortage and a later ready date for the order.",
            )
    return files


def write_readme(files: list[TestFile], folder: Path) -> None:
    lines = [
        "# Test purchase orders",
        "",
        f"Made on {datetime.now(UTC):%Y-%m-%d} from the scenarios seed. Dates are relative to that day,",
        "so make a fresh set if you test on a later day (python -m app.simulator test-pos).",
        "Upload each file on the Orders page, or email it to the orders inbox.",
        "",
        "| File | What it tests | What should happen |",
        "|---|---|---|",
    ]
    for test_file in files:
        tests = " ".join([test_file.tests, *test_file.details]).replace("|", "/")
        lines.append(f"| {test_file.file_name} | {tests} | {test_file.expected.replace('|', '/')} |")
    (folder / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


async def write_test_files(folder: Path) -> list[str]:
    files = await build_test_files()
    folder.mkdir(parents=True, exist_ok=True)
    for test_file in files:
        (folder / test_file.file_name).write_bytes(test_file.content)
    write_readme(files, folder)
    return [test_file.file_name for test_file in files]
