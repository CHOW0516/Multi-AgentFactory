"""Demo seed data: a small CNC and sheet-metal contract manufacturer.

Run: python -m app.simulator seed           (refuses if data already exists)
     python -m app.simulator seed --reset   (wipes every table first)
Deterministic: uses SIM_RANDOM_SEED.
"""

import logging
import random
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import session_scope
from app.core.security import hash_password
from app.models import (
    Base,
    BomLine,
    Customer,
    Holiday,
    Machine,
    MachineEvent,
    Material,
    Order,
    OrderLine,
    Part,
    Quotation,
    Routing,
    ScheduleSlot,
    Shift,
    StockMovement,
    Supplier,
    SupplierItem,
    User,
)

logger = logging.getLogger(__name__)

MACHINES = [
    # code, name, machine_type, floor_x, floor_y  (floor grid 0..1000; store/racks sit at x < 150)
    ("LATHE-01", "CNC Lathe 1", "cnc_lathe", 250, 200),
    ("LATHE-02", "CNC Lathe 2", "cnc_lathe", 400, 200),
    ("MILL-01", "CNC Mill 1", "cnc_mill", 250, 450),
    ("MILL-02", "CNC Mill 2", "cnc_mill", 400, 450),
    ("LASER-01", "Fiber Laser Cutter", "laser_cutter", 650, 200),
    ("BRAKE-01", "Press Brake", "press_brake", 650, 450),
    ("QC-01", "QC Station", "qc_station", 850, 300),
    ("PACK-01", "Packing Table", "packing", 850, 600),
]

# Typical power use in kW by machine type (running, idle but switched on). Demo values only.
MACHINE_POWER_KW = {
    "cnc_lathe": (15, 2),
    "cnc_mill": (18, 2.5),
    "laser_cutter": (30, 5),
    "press_brake": (20, 3),
    "qc_station": (1, 0.3),
    "packing": (0.5, 0.1),
}

ROLE_USERS = [
    ("Aisha Manager", "manager@factory.local", "manager"),
    ("Daniel Backup Manager", "manager2@factory.local", "manager"),
    ("Mei Sales", "sales@factory.local", "sales"),
    ("Ravi Planner", "planner@factory.local", "planner"),
    ("Siti Store", "store@factory.local", "store"),
    ("Kumar QC", "qc@factory.local", "qc"),
]

CUSTOMERS = [
    ("ACME", "Acme Automation Sdn Bhd"),
    ("BRISK", "Brisk Medical Devices"),
    ("CORAL", "Coral Electronics"),
    ("DELTA", "Delta Robotics"),
    ("EVER", "Evergreen Packaging Machines"),
    ("FALCON", "Falcon Aerospace Components"),
    ("GAMMA", "Gamma Semiconductor Equipment"),
    ("HELIX", "Helix Pumps"),
    ("IRIS", "Iris Optical Instruments"),
    ("JADE", "Jade Furniture Systems"),
]

SUPPLIERS = [
    ("Metro Metals Supply", 5),
    ("Penang Steel Trading", 7),
    ("Klang Aluminium Works", 4),
    ("Fastener Hub", 3),
    ("Global Plastics & Coatings", 10),
]

# code, name, unit, unit_cost, kind
MATERIALS = [
    ("AL6061-RD-20", "Aluminium 6061 round bar 20mm", "m", "18.50", "bar"),
    ("AL6061-RD-30", "Aluminium 6061 round bar 30mm", "m", "32.00", "bar"),
    ("AL6061-RD-50", "Aluminium 6061 round bar 50mm", "m", "78.00", "bar"),
    ("SS304-RD-16", "Stainless 304 round bar 16mm", "m", "24.00", "bar"),
    ("SS304-RD-25", "Stainless 304 round bar 25mm", "m", "52.00", "bar"),
    ("SS316-RD-20", "Stainless 316 round bar 20mm", "m", "48.00", "bar"),
    ("BR-C360-RD-12", "Brass C360 round bar 12mm", "m", "21.00", "bar"),
    ("BR-C360-RD-20", "Brass C360 round bar 20mm", "m", "44.00", "bar"),
    ("S45C-RD-30", "Carbon steel S45C round bar 30mm", "m", "15.00", "bar"),
    ("POM-RD-25", "POM (acetal) round bar 25mm", "m", "12.00", "bar"),
    ("AL6061-PL-10", "Aluminium 6061 plate 10mm", "kg", "22.00", "plate"),
    ("AL6061-PL-20", "Aluminium 6061 plate 20mm", "kg", "22.00", "plate"),
    ("AL7075-PL-15", "Aluminium 7075 plate 15mm", "kg", "38.00", "plate"),
    ("SS304-PL-12", "Stainless 304 plate 12mm", "kg", "19.00", "plate"),
    ("S45C-PL-25", "Carbon steel S45C plate 25mm", "kg", "8.50", "plate"),
    ("SPCC-SH-1.2", "Mild steel sheet SPCC 1.2mm", "sheet", "65.00", "sheet"),
    ("SPCC-SH-2.0", "Mild steel sheet SPCC 2.0mm", "sheet", "98.00", "sheet"),
    ("SS304-SH-1.0", "Stainless 304 sheet 1.0mm", "sheet", "180.00", "sheet"),
    ("SS304-SH-1.5", "Stainless 304 sheet 1.5mm", "sheet", "240.00", "sheet"),
    ("AL5052-SH-1.5", "Aluminium 5052 sheet 1.5mm", "sheet", "150.00", "sheet"),
    ("AL5052-SH-3.0", "Aluminium 5052 sheet 3.0mm", "sheet", "260.00", "sheet"),
    ("GI-SH-1.0", "Galvanised steel sheet 1.0mm", "sheet", "70.00", "sheet"),
    ("M4-SCR-SS", "M4 x 10 stainless screw", "pcs", "0.12", "fastener"),
    ("M6-SCR-SS", "M6 x 16 stainless screw", "pcs", "0.25", "fastener"),
    ("M6-NUT-SS", "M6 stainless nut", "pcs", "0.08", "fastener"),
    ("M8-PEM-NUT", "M8 PEM self-clinching nut", "pcs", "0.45", "fastener"),
    ("DOWEL-6x20", "Dowel pin 6 x 20", "pcs", "0.30", "fastener"),
    ("ORING-NBR-20", "NBR O-ring 20mm", "pcs", "0.20", "fastener"),
    ("PWD-COAT-BLK", "Black powder coat", "kg", "28.00", "finish"),
    ("ANOD-CLR", "Clear anodising service", "pcs", "1.50", "finish"),
]

MACHINED_PARTS = [
    "Shaft",
    "Bushing",
    "Spacer",
    "Pin",
    "Flange",
    "Bracket block",
    "Manifold",
    "Housing",
    "Adapter",
    "Nozzle",
    "Coupling",
    "Valve body",
]
SHEET_PARTS = ["Cover", "Panel", "Bracket", "Enclosure", "Chassis", "Guard", "Tray", "Mounting plate"]

HOLIDAYS = [
    (date(2026, 12, 25), "Christmas Day"),
    (date(2027, 1, 1), "New Year's Day"),
    (date(2027, 2, 6), "Chinese New Year"),
    (date(2027, 2, 7), "Chinese New Year (day 2)"),
    (date(2027, 3, 10), "Hari Raya Aidilfitri"),
    (date(2027, 3, 11), "Hari Raya Aidilfitri (day 2)"),
    (date(2027, 5, 1), "Labour Day"),
    (date(2027, 8, 31), "National Day"),
    (date(2027, 9, 16), "Malaysia Day"),
]


async def database_has_data(session: AsyncSession) -> bool:
    return (await session.scalar(select(func.count()).select_from(User))) > 0


async def wipe_all_tables(session: AsyncSession) -> None:
    table_names = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    await session.execute(text(f"TRUNCATE {table_names} RESTART IDENTITY CASCADE"))


def money(value: float) -> Decimal:
    return Decimal(str(round(value, 2)))


async def seed(reset: bool = False) -> dict[str, int]:
    """Creates the demo factory. Returns counts of what was created."""
    randomizer = random.Random(settings.sim_random_seed)
    now = datetime.now(UTC)
    today = now.date()

    async with session_scope() as session:
        if reset:
            await wipe_all_tables(session)
        elif await database_has_data(session):
            raise RuntimeError("Database already has data. Use --reset to wipe it first.")

        # ---- users ----
        admin = User(
            name="Admin",
            email=settings.admin_email.lower(),
            role="admin",
            password_hash=hash_password(settings.admin_initial_password),
        )
        session.add(admin)
        demo_password_hash = hash_password(settings.admin_initial_password)
        users_by_email: dict[str, User] = {}
        for name, email, role in ROLE_USERS:
            user = User(name=name, email=email, role=role, password_hash=demo_password_hash)
            session.add(user)
            users_by_email[email] = user
        await session.flush()
        users_by_email["manager@factory.local"].backup_approver_id = users_by_email[
            "manager2@factory.local"
        ].id
        users_by_email["manager2@factory.local"].backup_approver_id = users_by_email[
            "manager@factory.local"
        ].id
        store_user = users_by_email["store@factory.local"]
        sales_user = users_by_email["sales@factory.local"]

        # ---- machines and calendar ----
        machines = [
            Machine(code=code, name=name, machine_type=machine_type, status="idle", floor_x=x, floor_y=y,
                    original_floor_x=x, original_floor_y=y,
                    running_kw=Decimal(str(MACHINE_POWER_KW[machine_type][0])),
                    idle_kw=Decimal(str(MACHINE_POWER_KW[machine_type][1])))
            for code, name, machine_type, x, y in MACHINES
        ]
        session.add_all(machines)
        for weekday in range(5):
            session.add(Shift(name="Day shift", weekday=weekday, start_time=time(8, 0), end_time=time(17, 0)))
            session.add(
                Shift(name="Evening shift", weekday=weekday, start_time=time(17, 0), end_time=time(23, 0))
            )
        session.add(Shift(name="Saturday half day", weekday=5, start_time=time(8, 0), end_time=time(13, 0)))
        session.add_all(Holiday(holiday_date=day, name=name) for day, name in HOLIDAYS)

        # ---- customers, suppliers, materials ----
        customers = [
            Customer(
                code=code,
                name=name,
                email=f"purchasing@{code.lower()}.example",
                address=f"{randomizer.randint(1, 99)} Jalan Industri {randomizer.randint(1, 20)}, Penang",
            )
            for code, name in CUSTOMERS
        ]
        session.add_all(customers)
        suppliers = [
            Supplier(name=name, email=f"sales{index}@supplier.example")
            for index, (name, _lead_time) in enumerate(SUPPLIERS, start=1)
        ]
        session.add_all(suppliers)
        materials = [
            Material(
                code=code,
                name=name,
                unit=unit,
                unit_cost=Decimal(cost),
                min_stock=Decimal(50 if unit in ("pcs",) else 10),
                last_counted_at=now - timedelta(days=randomizer.randint(2, 45)),
            )
            for code, name, unit, cost, _kind in MATERIALS
        ]
        session.add_all(materials)
        await session.flush()

        material_kind = {code: kind for code, _name, _unit, _cost, kind in MATERIALS}
        materials_by_kind: dict[str, list[Material]] = {}
        for material in materials:
            materials_by_kind.setdefault(material_kind[material.code], []).append(material)

        for material in materials:
            for supplier_index in randomizer.sample(range(len(SUPPLIERS)), 2):
                session.add(
                    SupplierItem(
                        supplier_id=suppliers[supplier_index].id,
                        material_id=material.id,
                        lead_time_days=SUPPLIERS[supplier_index][1] + randomizer.randint(0, 4),
                        unit_price=material.unit_cost,
                    )
                )
            # opening stock, then a few receipts and issues over the last 3 months
            opening = Decimal(
                randomizer.choice([2000, 3000, 5000])
                if material.unit == "pcs"
                else randomizer.choice([20, 40, 80, 120])
            )
            session.add(
                StockMovement(
                    material_id=material.id,
                    quantity=opening,
                    movement_type="receive",
                    reference="Opening stock",
                    user_id=store_user.id,
                )
            )

        # ---- parts with BOM and routing ----
        parts: list[Part] = []
        part_is_sheet: dict[int, bool] = {}
        for index in range(40):
            is_sheet = index % 5 in (3, 4)  # 16 sheet-metal parts, 24 machined parts
            customer = customers[index % len(customers)]
            base_name = randomizer.choice(SHEET_PARTS if is_sheet else MACHINED_PARTS)
            part = Part(
                part_number=f"{customer.code}-{1000 + index * 7}",
                revision=randomizer.choice(["A", "B", "C"]),
                description=f"{base_name}, {customer.code}",
                customer_id=customer.id,
                qc_sample_every=randomizer.choice([20, 50, 100]),
                qc_notes="Check critical diameter and length"
                if not is_sheet
                else "Check bend angles and hole positions",
            )
            session.add(part)
            parts.append(part)
            part_is_sheet[index] = is_sheet
        await session.flush()

        for index, part in enumerate(parts):
            if part_is_sheet[index]:
                sheet = randomizer.choice(materials_by_kind["sheet"])
                session.add(
                    BomLine(
                        part_id=part.id,
                        material_id=sheet.id,
                        quantity_per_part=Decimal(str(randomizer.choice([0.05, 0.08, 0.125, 0.2]))),
                        scrap_rate=Decimal("0.05"),
                    )
                )
                nut = randomizer.choice(materials_by_kind["fastener"])
                session.add(
                    BomLine(
                        part_id=part.id,
                        material_id=nut.id,
                        quantity_per_part=Decimal(randomizer.choice([2, 4, 6])),
                        scrap_rate=Decimal("0.01"),
                    )
                )
                steps = [
                    ("laser_cutter", 20, randomizer.randint(30, 90)),
                    ("press_brake", 30, randomizer.randint(40, 120)),
                ]
            else:
                stock_material = randomizer.choice(materials_by_kind["bar"] + materials_by_kind["plate"])
                per_part = (
                    Decimal(str(randomizer.choice([0.05, 0.08, 0.12, 0.2])))
                    if stock_material.unit == "m"
                    else Decimal(str(randomizer.choice([0.1, 0.25, 0.4, 0.8])))
                )
                session.add(
                    BomLine(
                        part_id=part.id,
                        material_id=stock_material.id,
                        quantity_per_part=per_part,
                        scrap_rate=Decimal("0.03"),
                    )
                )
                steps = [("cnc_lathe", 45, randomizer.randint(60, 240))]
                if randomizer.random() < 0.6:
                    steps.append(("cnc_mill", 60, randomizer.randint(90, 300)))
            steps += [
                ("qc_station", 10, randomizer.randint(15, 45)),
                ("packing", 5, randomizer.randint(5, 15)),
            ]
            for step_number, (machine_type, setup_minutes, cycle_seconds) in enumerate(steps, start=1):
                session.add(
                    Routing(
                        part_id=part.id,
                        step_number=step_number * 10,
                        machine_type=machine_type,
                        setup_minutes=setup_minutes,
                        cycle_seconds_per_part=Decimal(cycle_seconds),
                    )
                )

        # ---- quotations for half of the parts ----
        unit_prices: dict[uuid.UUID, Decimal] = {}
        for index, part in enumerate(parts):
            unit_prices[part.id] = money(
                randomizer.uniform(4, 25) if part_is_sheet[index] else randomizer.uniform(8, 60)
            )
        for index, part in enumerate(parts[::2]):
            session.add(
                Quotation(
                    quote_number=f"QT-{today.year}-{index + 1:04d}",
                    customer_id=part.customer_id,
                    part_id=part.id,
                    quantity=Decimal(randomizer.choice([200, 500, 1000, 2000])),
                    unit_price=unit_prices[part.id],
                    quoted_due_date=today + timedelta(days=randomizer.randint(14, 45)),
                    status="open",
                    created_by=sales_user.id,
                )
            )

        # ---- 3 months of finished orders ----
        machines_by_type: dict[str, list[Machine]] = {}
        for machine in machines:
            machines_by_type.setdefault(machine.machine_type, []).append(machine)
        await session.flush()
        bom_by_part: dict[uuid.UUID, list[BomLine]] = {}
        for line in (await session.scalars(select(BomLine))).all():
            bom_by_part.setdefault(line.part_id, []).append(line)
        routing_by_part: dict[uuid.UUID, list[Routing]] = {}
        for step in (await session.scalars(select(Routing))).all():
            routing_by_part.setdefault(step.part_id, []).append(step)
        issued_by_material: dict[uuid.UUID, Decimal] = {}

        history_orders = 60
        for order_index in range(history_orders):
            part_index = randomizer.randrange(len(parts))
            part = parts[part_index]
            created = now - timedelta(days=randomizer.randint(10, 92), hours=randomizer.randint(0, 9))
            due = (created + timedelta(days=randomizer.randint(14, 30))).date()
            is_late = randomizer.random() < 0.18
            finished = (
                due + timedelta(days=randomizer.randint(1, 6))
                if is_late
                else due - timedelta(days=randomizer.randint(0, 4))
            )
            finished = min(finished, today - timedelta(days=1))
            quantity = Decimal(randomizer.choice([100, 200, 300, 500, 800, 1000]))
            order = Order(
                order_number=f"SO-{created.year}-{order_index + 1:04d}",
                customer_id=part.customer_id,
                po_number=f"PO-{randomizer.randint(10000, 99999)}",
                status="COMPLETED",
                due_date=due,
                promised_date=due,
                completed_at=datetime.combine(finished, time(16, 0), tzinfo=UTC),
            )
            order.created_at = created
            session.add(order)
            await session.flush()
            session.add(
                OrderLine(
                    order_id=order.id,
                    line_number=1,
                    part_id=part.id,
                    part_number_text=part.part_number,
                    revision_text=part.revision,
                    quantity=quantity,
                    unit_price=unit_prices[part.id],
                )
            )
            # material issued for the order
            for bom_line in bom_by_part.get(part.id, []):
                issued = (quantity * bom_line.quantity_per_part * (1 + bom_line.scrap_rate)).quantize(
                    Decimal("0.001")
                )
                issued_by_material[bom_line.material_id] = (
                    issued_by_material.get(bom_line.material_id, Decimal(0)) + issued
                )
                session.add(
                    StockMovement(
                        material_id=bom_line.material_id,
                        quantity=-issued,
                        movement_type="issue",
                        reference=order.order_number,
                        order_id=order.id,
                        user_id=store_user.id,
                    )
                )
            # done schedule slots, working back from the finish day
            slot_end = datetime.combine(finished, time(16, 0), tzinfo=UTC)
            for step in sorted(
                routing_by_part.get(part.id, []), key=lambda item: item.step_number, reverse=True
            ):
                minutes = step.setup_minutes + float(step.cycle_seconds_per_part * quantity) / 60
                slot_start = slot_end - timedelta(minutes=minutes)
                machine = randomizer.choice(machines_by_type[step.machine_type])
                session.add(
                    ScheduleSlot(
                        order_id=order.id,
                        machine_id=machine.id,
                        routing_step=step.step_number,
                        quantity=quantity,
                        start_at=slot_start,
                        end_at=slot_end,
                        status="done",
                    )
                )
                session.add(
                    MachineEvent(
                        machine_id=machine.id,
                        event_type="count",
                        value=str(int(quantity)),
                        order_id=order.id,
                        happened_at=slot_end,
                    )
                )
                slot_end = slot_start - timedelta(minutes=30)

        # supplier deliveries over the period: what was used, plus a healthy buffer, so stock stays positive
        for material in materials:
            used = issued_by_material.get(material.id, Decimal(0))
            buffer = Decimal(
                randomizer.choice([500, 1000]) if material.unit == "pcs" else randomizer.choice([10, 20, 40])
            )
            if used > 0 or buffer > 0:
                session.add(
                    StockMovement(
                        material_id=material.id,
                        movement_type="receive",
                        reference="Supplier delivery",
                        quantity=(used + buffer).quantize(Decimal("1")),
                        user_id=store_user.id,
                    )
                )

    counts = {
        "users": len(ROLE_USERS) + 1,
        "machines": len(MACHINES),
        "customers": len(CUSTOMERS),
        "suppliers": len(SUPPLIERS),
        "materials": len(MATERIALS),
        "parts": 40,
        "quotations": 20,
        "history_orders": history_orders,
    }
    logger.info("Seed complete: %s", counts)
    return counts
