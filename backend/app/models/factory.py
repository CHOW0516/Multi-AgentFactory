"""Machines, working calendar, machine and maintenance events."""

import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TableBase


class Machine(TableBase):
    __tablename__ = "machines"

    code: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    machine_type: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(
        String(20), default="idle"
    )  # running | idle | setup | down | maintenance
    floor_x: Mapped[int] = mapped_column(Integer, default=0)
    floor_y: Mapped[int] = mapped_column(Integer, default=0)


class Shift(TableBase):
    __tablename__ = "shifts"

    name: Mapped[str] = mapped_column(String(60))
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = Monday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


class Holiday(TableBase):
    __tablename__ = "holidays"

    holiday_date: Mapped[date] = mapped_column(Date, unique=True)
    name: Mapped[str] = mapped_column(String(120))


class MachineEvent(TableBase):
    __tablename__ = "machine_events"

    machine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("machines.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(20))  # status | count
    value: Mapped[str] = mapped_column(String(60))
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"))
    happened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class MaintenanceEvent(TableBase):
    __tablename__ = "maintenance_events"

    machine_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("machines.id"), index=True)
    maintenance_type: Mapped[str] = mapped_column(String(20))  # breakdown | planned
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    downtime_hours: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
