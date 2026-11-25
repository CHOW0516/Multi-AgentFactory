"""Sales quotations and read-only delivery estimates."""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.planning.service import what_if
from app.api.master_data import commit_or_conflict, create_row, flush_or_conflict, get_or_404
from app.api.orders import sales_only
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_session
from app.models import Customer, Part, Quotation, User
from app.schemas.api import QuotationIn, QuotationOut, WhatIfRequest, WhatIfResult

router = APIRouter(tags=["quotations"])
QuoteStatus = Literal["open", "accepted", "expired", "cancelled"]


@router.get("/quotations", response_model=list[QuotationOut])
async def list_quotations(
    customer_id: UUID | None = None,
    status: QuoteStatus | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    query = select(Quotation).order_by(Quotation.created_at.desc(), Quotation.id)
    if customer_id is not None:
        query = query.where(Quotation.customer_id == customer_id)
    if status is not None:
        query = query.where(Quotation.status == status)
    return list(await session.scalars(query))


@router.get("/quotations/{quotation_id}", response_model=QuotationOut)
async def get_quotation(
    quotation_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    return await get_or_404(session, Quotation, quotation_id)


async def validate_quote(session: AsyncSession, body: QuotationIn) -> None:
    await get_or_404(session, Customer, body.customer_id)
    part = await get_or_404(session, Part, body.part_id)
    if part.customer_id is not None and part.customer_id != body.customer_id:
        raise HTTPException(422, "Part belongs to a different customer")
    if not 0 < body.quantity < Decimal("100000000000") or body.quantity != body.quantity.quantize(
        Decimal("0.001")
    ):
        raise HTTPException(422, "Quotation quantity must be positive with at most three decimal places")
    if not 0 <= body.unit_price < Decimal("1000000000000") or body.unit_price != body.unit_price.quantize(
        Decimal("0.01")
    ):
        raise HTTPException(422, "Unit price must be non-negative with at most two decimal places")


@router.post("/quotations", response_model=QuotationOut, status_code=201)
async def create_quotation(
    body: QuotationIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    await validate_quote(session, body)
    year = datetime.now(ZoneInfo(settings.app_timezone)).year
    return await create_row(
        session,
        user,
        Quotation,
        body.model_dump()
        | {
            "quote_number": f"QT-{year}-{uuid4().hex[:16].upper()}",
            "status": "open",
            "created_by": user.id,
        },
    )


@router.patch("/quotations/{quotation_id}", response_model=QuotationOut)
async def edit_quotation(
    quotation_id: UUID,
    patch: dict,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    row = await session.get(Quotation, quotation_id, with_for_update={"key_share": True})
    if row is None:
        raise HTTPException(404, "Quotation not found")
    if set(patch) - (set(QuotationIn.model_fields) | {"status"}):
        raise HTTPException(422, "Unknown quotation fields")
    status = patch.get("status", row.status)
    if status not in ("open", "accepted", "expired", "cancelled"):
        raise HTTPException(422, "Unknown quotation status")
    values = {field: patch.get(field, getattr(row, field)) for field in QuotationIn.model_fields}
    try:
        body = QuotationIn.model_validate(values)
    except ValueError as error:
        raise HTTPException(422, "Invalid quotation fields") from error
    await validate_quote(session, body)
    before = QuotationOut.model_validate(row).model_dump(mode="json")
    for field, value in (body.model_dump() | {"status": status}).items():
        setattr(row, field, value)
    await flush_or_conflict(session)
    after = QuotationOut.model_validate(row)
    await write_audit(session, user, "update", "quotations", row.id, before, after.model_dump(mode="json"))
    await commit_or_conflict(session)
    return after


@router.post("/quotations/{quotation_id}/check-date", response_model=WhatIfResult)
async def check_date(
    quotation_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    quote = await get_or_404(session, Quotation, quotation_id)
    if quote.quoted_due_date is None:
        raise HTTPException(422, "Set a quotation due date before checking it")
    request = WhatIfRequest(part_id=quote.part_id, quantity=quote.quantity, due_date=quote.quoted_due_date)
    try:
        return await what_if(session, request)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
