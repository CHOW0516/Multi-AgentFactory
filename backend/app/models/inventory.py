"""Stock is the sum of movements. Never store a stock total that people overwrite."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Quantity, TableBase


class StockMovement(TableBase):
    __tablename__ = "stock_movements"

    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Quantity)  # positive in, negative out
    movement_type: Mapped[str] = mapped_column(String(20))  # receive | issue | scrap | return | adjust
    reference: Mapped[str | None] = mapped_column(String(200))
    reason: Mapped[str | None] = mapped_column(String(300))
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class StockHold(TableBase):
    __tablename__ = "stock_holds"

    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    hold_type: Mapped[str] = mapped_column(String(20))  # temporary | firm
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PurchaseRequest(TableBase):
    __tablename__ = "purchase_requests"

    material_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("materials.id"))
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("suppliers.id"))
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    needed_by: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | sent | received | cancelled
