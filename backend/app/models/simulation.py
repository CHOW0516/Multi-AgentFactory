"""Saved machine lines for the line simulator (a sandbox: never touches real machines or orders)."""

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TableBase


class SimLine(TableBase):
    __tablename__ = "sim_lines"

    name: Mapped[str] = mapped_column(String(120))
    design: Mapped[dict] = mapped_column(JSONB, default=dict)  # {blocks, links, jobs}; shape checked by the API
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
