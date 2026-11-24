"""Parts, bills of materials, routings, materials, suppliers, quotations."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Money, Quantity, TableBase


class Part(TableBase):
    __tablename__ = "parts"
    __table_args__ = (UniqueConstraint("part_number", "revision", name="part_number_revision"),)

    part_number: Mapped[str] = mapped_column(String(60), index=True)
    revision: Mapped[str] = mapped_column(String(10))
    description: Mapped[str | None] = mapped_column(String(300))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"))
    qc_sample_every: Mapped[int] = mapped_column(Integer, default=50)
    qc_notes: Mapped[str | None] = mapped_column(Text)


class Material(TableBase):
    __tablename__ = "materials"

    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str] = mapped_column(String(20))
    min_stock: Mapped[Decimal] = mapped_column(Quantity, default=0)
    unit_cost: Mapped[Decimal | None] = mapped_column(Money)
    last_counted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BomLine(TableBase):
    __tablename__ = "bom_lines"

    part_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"), index=True)
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"))
    quantity_per_part: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    scrap_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=0)


class Routing(TableBase):
    __tablename__ = "routings"
    __table_args__ = (UniqueConstraint("part_id", "step_number", name="part_step"),)

    part_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parts.id", ondelete="CASCADE"), index=True)
    step_number: Mapped[int] = mapped_column(Integer)
    machine_type: Mapped[str] = mapped_column(String(40))
    setup_minutes: Mapped[int] = mapped_column(Integer, default=0)
    cycle_seconds_per_part: Mapped[Decimal] = mapped_column(Numeric(10, 2))


class Supplier(TableBase):
    __tablename__ = "suppliers"

    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200))


class SupplierItem(TableBase):
    __tablename__ = "supplier_items"
    __table_args__ = (UniqueConstraint("supplier_id", "material_id", name="supplier_material"),)

    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"))
    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"), index=True)
    lead_time_days: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal | None] = mapped_column(Money)


class Quotation(TableBase):
    __tablename__ = "quotations"

    quote_number: Mapped[str] = mapped_column(String(40), unique=True)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id"), index=True)
    part_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("parts.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    quoted_due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | accepted | expired | cancelled
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
