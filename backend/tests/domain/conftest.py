from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import AppSetting, Customer, Material, Order, OrderLine, Part, StockMovement


@dataclass
class Catalog:
    customer: Customer
    part: Part
    material: Material


@pytest.fixture
async def catalog(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "document_storage_path", str(tmp_path))
    customer = Customer(code="ACME", name="Acme Industries")
    material = Material(code="AL-01", name="Aluminium", unit="kg", unit_cost=Decimal("3"))
    db_session.add_all([customer, material])
    await db_session.flush()
    part = Part(part_number="PX-14", revision="A", customer_id=customer.id)
    db_session.add(part)
    await db_session.commit()
    return Catalog(customer, part, material)


@pytest.fixture
async def make_order(db_session, catalog):
    async def create(quantity=10, *, status="VERIFIED", due_date=None, priority=5, po_number=None):
        return await insert_order(db_session, catalog, quantity, status, due_date, priority, po_number)

    return create


async def insert_order(
    session: AsyncSession,
    catalog: Catalog,
    quantity: int,
    status: str,
    due_date: date | None,
    priority: int,
    po_number: str | None,
) -> Order:
    order = Order(
        order_number=f"SO-TEST-{uuid4().hex[:16]}",
        customer_id=catalog.customer.id,
        po_number=po_number,
        status=status,
        due_date=due_date,
        priority=priority,
    )
    session.add(order)
    await session.flush()
    session.add(
        OrderLine(
            order_id=order.id,
            line_number=1,
            part_id=catalog.part.id,
            part_number_text=catalog.part.part_number,
            revision_text=catalog.part.revision,
            quantity=Decimal(quantity),
            unit_price=Decimal("25"),
        )
    )
    await session.commit()
    return order


@pytest.fixture
async def make_stock(db_session, catalog):
    async def receive(quantity):
        db_session.add(
            StockMovement(
                material_id=catalog.material.id, quantity=Decimal(quantity), movement_type="receive"
            )
        )
        await db_session.commit()

    return receive


@pytest.fixture
async def planning_clock(db_session, monkeypatch):
    from app.agents.planning import service

    now = datetime(2027, 1, 4, 7, 0, tzinfo=UTC)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(service, "datetime", FixedDateTime)
    monkeypatch.setattr(get_settings(), "app_timezone", "UTC")
    db_session.add_all(
        [
            AppSetting(key=key, value=str(value))
            for key, value in {
                "qc_buffer_hours": 0,
                "shipping_buffer_days": 0,
                "overtime_rate_per_hour": 60,
                "planning_solver_time_limit_seconds": 6,
            }.items()
        ]
    )
    await db_session.commit()
    return now
