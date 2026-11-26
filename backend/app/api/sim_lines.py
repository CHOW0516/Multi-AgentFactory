"""Saved lines for the machine line simulator.

The simulation itself runs in the desktop app. The server only stores the drawn line so it can be
opened again and shared. Managers and planners (and admin) can read and edit.
"""

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.db import get_session
from app.core.security import require_roles
from app.models import SimLine, User

router = APIRouter(tags=["line simulator"])
line_users = require_roles("manager", "planner")  # admin is always allowed


class SimBlock(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: Literal["source", "machine", "sink"]
    name: str = Field(min_length=1, max_length=60)
    machineType: str = Field(max_length=40)
    x: float
    y: float
    cycleSeconds: float = Field(ge=0, le=86_400)
    setupMinutes: float = Field(ge=0, le=10_000)
    scrapPercent: float = Field(ge=0, le=100)
    breakdownsPerDay: float = Field(ge=0, le=100)
    repairMinutes: float = Field(ge=0, le=10_000)


class SimLink(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    # "from" is a Python keyword, so the field is named from_id and read/written as "from".
    model_config = ConfigDict(populate_by_name=True)
    from_id: str = Field(alias="from", max_length=40)
    to: str = Field(max_length=40)


class SimJob(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    quantity: int = Field(ge=1, le=20_000)
    startHour: float = Field(ge=0, le=8_760)
    dueHour: float = Field(ge=0, le=8_760)


class SimDesign(BaseModel):
    blocks: list[SimBlock] = Field(max_length=100)
    links: list[SimLink] = Field(max_length=400)
    jobs: list[SimJob] = Field(max_length=100)


class SimLineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    design: SimDesign


class SimLineSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    updated_at: datetime


class SimLineOut(SimLineSummary):
    design: dict


def design_json(body: SimLineIn) -> dict:
    return body.design.model_dump(by_alias=True)


async def get_line(session: AsyncSession, line_id: uuid.UUID) -> SimLine:
    line = await session.get(SimLine, line_id)
    if line is None:
        raise HTTPException(404, "Line not found")
    return line


@router.get("/sim-lines", response_model=list[SimLineSummary])
async def list_lines(session: AsyncSession = Depends(get_session), user: User = Depends(line_users)):
    return (await session.scalars(select(SimLine).order_by(SimLine.name))).all()


@router.get("/sim-lines/{line_id}", response_model=SimLineOut)
async def read_line(line_id: uuid.UUID, session: AsyncSession = Depends(get_session), user: User = Depends(line_users)):
    return await get_line(session, line_id)


@router.post("/sim-lines", response_model=SimLineOut, status_code=201)
async def create_line(body: SimLineIn, session: AsyncSession = Depends(get_session), user: User = Depends(line_users)):
    line = SimLine(name=body.name.strip(), design=design_json(body), created_by=user.id)
    session.add(line)
    await session.flush()
    await write_audit(session, user, "create", "sim_line", line.id, after={"name": line.name})
    await session.commit()
    await session.refresh(line)
    return line


@router.put("/sim-lines/{line_id}", response_model=SimLineOut)
async def update_line(
    line_id: uuid.UUID, body: SimLineIn, session: AsyncSession = Depends(get_session), user: User = Depends(line_users)
):
    line = await get_line(session, line_id)
    line.name = body.name.strip()
    line.design = design_json(body)
    await write_audit(session, user, "update", "sim_line", line.id, after={"name": line.name})
    await session.commit()
    await session.refresh(line)
    return line


@router.delete("/sim-lines/{line_id}", status_code=204)
async def delete_line(line_id: uuid.UUID, session: AsyncSession = Depends(get_session), user: User = Depends(line_users)):
    line = await get_line(session, line_id)
    await write_audit(session, user, "delete", "sim_line", line.id, before={"name": line.name})
    await session.delete(line)
    await session.commit()
