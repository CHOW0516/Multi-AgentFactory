"""Order intake, field review, and approval-pack reads."""

from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.material.service import material_status
from app.agents.order.events import flush_events, stage_event
from app.agents.order.extraction import link_previous, reconcile
from app.agents.order.intake import MAX_DOCUMENT_BYTES, Attachment, document_path, store_documents
from app.api.master_data import get_or_404
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_session
from app.core.security import current_user, require_roles
from app.models import (
    CLOSED_ORDER_STATES,
    AuditLog,
    Customer,
    CustomerMessage,
    ExtractedField,
    Order,
    OrderLine,
    PlanOption,
    SourceDocument,
    User,
    WorkflowRun,
)
from app.orchestrator import workflow
from app.schemas.api import (
    CustomerMessageOut,
    ExtractedFieldOut,
    FieldCorrection,
    MaterialStatusOut,
    OrderDetail,
    OrderLineOut,
    OrderSummary,
    Page,
    PlanOptionOut,
)

router = APIRouter(tags=["orders"])
CLOSED = ("COMPLETED", "REJECTED", "DECLINED", "FAILED", "CANCELLED")


async def sales_only(user: User = Depends(current_user)) -> User:
    if user.role != "sales":
        raise HTTPException(403, "Only sales users may do this")
    return user


async def commercial_reader(user: User = Depends(current_user)) -> User:
    if user.role == "store":
        raise HTTPException(403, "This endpoint contains commercial information")
    return user


def risk_expression():
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    return func.coalesce(
        and_(
            Order.due_date.is_not(None),
            or_(
                Order.promised_date > Order.due_date,
                and_(Order.due_date < today, Order.status.not_in(CLOSED)),
            ),
        ),
        False,
    )


def summary(row: Order, customer_name: str | None, late: bool) -> OrderSummary:
    return OrderSummary(
        id=row.id,
        order_number=row.order_number,
        customer_id=row.customer_id,
        customer_name=customer_name,
        po_number=row.po_number,
        status=row.status,
        due_date=row.due_date,
        promised_date=row.promised_date,
        late_risk=late,
        created_at=row.created_at,
    )


@router.get("/orders", response_model=Page[OrderSummary])
async def list_orders(
    status: str | None = None,
    customer_id: UUID | None = None,
    due_from: date | None = None,
    due_to: date | None = None,
    late_risk: bool | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    if due_from is not None and due_to is not None and due_from > due_to:
        raise HTTPException(422, "Due date range is reversed")
    risk = risk_expression()
    filters = []
    if status is not None:
        filters.append(Order.status == status)
    if customer_id is not None:
        filters.append(Order.customer_id == customer_id)
    if due_from is not None:
        filters.append(Order.due_date >= due_from)
    if due_to is not None:
        filters.append(Order.due_date <= due_to)
    if late_risk is not None:
        filters.append(risk == late_risk)
    total = await session.scalar(select(func.count()).select_from(Order).where(*filters))
    rows = await session.execute(
        select(Order, Customer.name, risk)
        .outerjoin(Customer, Customer.id == Order.customer_id)
        .where(*filters)
        .order_by(Order.created_at.desc(), Order.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return Page[OrderSummary](
        items=[summary(order, name, late) for order, name, late in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/orders/upload", response_model=OrderSummary, status_code=201)
async def upload_order(file: UploadFile, user: User = Depends(sales_only)):
    try:
        data = await file.read(MAX_DOCUMENT_BYTES + 1)
        (order,) = await store_documents([Attachment(file.filename or "", data)], user=user)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    finally:
        await file.close()
    return summary(order, None, False)


@router.get("/orders/{order_id}", response_model=OrderDetail)
async def order_detail(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    row = (
        await session.execute(
            select(Order, Customer.name, risk_expression())
            .outerjoin(Customer, Customer.id == Order.customer_id)
            .where(Order.id == order_id)
        )
    ).first()
    if row is None:
        raise HTTPException(404, "Order not found")
    order, name, late = row
    lines = list(
        await session.scalars(
            select(OrderLine)
            .where(OrderLine.order_id == order.id)
            .order_by(OrderLine.line_number, OrderLine.id)
        )
    )
    can_see_prices = user.role != "store"
    return OrderDetail(
        **summary(order, name, late).model_dump(),
        po_revision=order.po_revision,
        delivery_address=order.delivery_address,
        notes=order.notes if can_see_prices else None,
        quotation_id=order.quotation_id if can_see_prices else None,
        source_document_id=order.source_document_id if can_see_prices else None,
        lines=[
            OrderLineOut.model_validate(line).model_copy(update={"unit_price": None})
            if not can_see_prices
            else OrderLineOut.model_validate(line)
            for line in lines
        ],
    )


@router.get("/orders/{order_id}/document")
async def download_document(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(commercial_reader),
):
    order = await get_or_404(session, Order, order_id)
    document = (
        await session.get(SourceDocument, order.source_document_id) if order.source_document_id else None
    )
    if document is None:
        raise HTTPException(404, "Order document not found")
    try:
        path = document_path(document.file_path)
    except ValueError as error:
        raise HTTPException(404, "Order document not found") from error
    if not path.is_file():
        raise HTTPException(404, "Order document not found")
    return FileResponse(
        path, media_type=document.mime_type, filename=document.file_name, content_disposition_type="inline"
    )


async def field_rows(session: AsyncSession, order_id: UUID) -> list[ExtractedField]:
    return list(
        await session.scalars(
            select(ExtractedField)
            .where(ExtractedField.order_id == order_id)
            .order_by(ExtractedField.created_at, ExtractedField.field_name)
        )
    )


@router.get("/orders/{order_id}/fields", response_model=list[ExtractedFieldOut])
async def get_fields(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(commercial_reader),
):
    await get_or_404(session, Order, order_id)
    return await field_rows(session, order_id)


async def review_order(session: AsyncSession, order_id: UUID) -> Order:
    order = await session.get(Order, order_id, with_for_update={"key_share": True})
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status != "NEEDS_FIELD_CHECK":
        raise HTTPException(409, "This order is not open for field review")
    return order


async def review_audit(session: AsyncSession, order_id: UUID) -> AuditLog | None:
    return await session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "confirm_fields",
            AuditLog.entity == "orders",
            AuditLog.entity_id == str(order_id),
        )
        .order_by(AuditLog.created_at.desc())
        .limit(1)
    )


@router.patch("/orders/{order_id}/fields", response_model=list[ExtractedFieldOut])
async def patch_fields(
    order_id: UUID,
    corrections: list[FieldCorrection],
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    await review_order(session, order_id)
    if await review_audit(session, order_id):
        raise HTTPException(409, "The field review has already been confirmed")
    rows = await field_rows(session, order_id)
    by_id = {row.id: row for row in rows}
    if len({patch.field_id for patch in corrections}) != len(corrections):
        raise HTTPException(422, "Each field may be corrected only once per request")
    for patch in corrections:
        row = by_id.get(patch.field_id)
        if row is None or not row.needs_check:
            raise HTTPException(422, "Only flagged fields on this order can be corrected")
        before = {"corrected_value": row.corrected_value}
        row.corrected_value, row.corrected_by = patch.corrected_value.strip(), user.id
        await write_audit(
            session,
            user,
            "correct",
            "extracted_fields",
            row.id,
            before,
            {"corrected_value": row.corrected_value, "field_name": row.field_name},
        )
    await session.commit()
    return rows


@router.post("/orders/{order_id}/fields/confirm", response_model=OrderSummary)
async def confirm_fields(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    order = await session.get(Order, order_id, with_for_update={"key_share": True})
    if order is None:
        raise HTTPException(404, "Order not found")
    prior = await review_audit(session, order_id)
    if not prior:
        await review_order(session, order_id)
        rows = await field_rows(session, order_id)
        reconciled = await reconcile(session, order, rows, review=True)
        if reconciled.blocking:
            raise HTTPException(422, reconciled.blocking)
        lines = {
            row.line_number: row
            for row in await session.scalars(select(OrderLine).where(OrderLine.order_id == order_id))
        }
        for new in reconciled.lines:
            old = lines.get(new.line_number)
            if old is None:
                session.add(new)
            else:
                for field in ("part_id", "part_number_text", "revision_text", "quantity", "unit_price"):
                    setattr(old, field, getattr(new, field))
        for row in rows:
            row.needs_check = False
        await link_previous(session, order)
        await stage_event(session, order.id, "event.order.fields_corrected", from_agent="api")
        await write_audit(
            session,
            user,
            "confirm_fields",
            "orders",
            order.id,
            None,
            {"field_ids": [str(row.id) for row in rows]},
        )
    customer = await session.get(Customer, order.customer_id) if order.customer_id else None
    await session.commit()
    await flush_events(order_id, retry=True)
    late = bool(
        order.due_date
        and order.due_date < datetime.now(ZoneInfo(settings.app_timezone)).date()
        and order.status not in CLOSED
    )
    return summary(order, customer.name if customer else None, late)


@router.get("/orders/{order_id}/plan-options", response_model=list[PlanOptionOut])
async def plan_options(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(commercial_reader),
):
    await get_or_404(session, Order, order_id)
    return list(
        await session.scalars(
            select(PlanOption)
            .where(
                PlanOption.order_id == order_id,
                PlanOption.status != "discarded",
            )
            .order_by(PlanOption.is_recommended.desc(), PlanOption.created_at, PlanOption.option_type)
        )
    )


@router.get("/orders/{order_id}/material-status", response_model=MaterialStatusOut)
async def get_material_status(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await get_or_404(session, Order, order_id)
    try:
        return await material_status(session, order_id)
    except ValueError:
        return MaterialStatusOut(material_ready_date=None, hold_expires_at=None, needs=[], data_warnings=[])


async def latest_message(session: AsyncSession, order_id: UUID) -> CustomerMessage:
    row = await session.scalar(
        select(CustomerMessage)
        .where(CustomerMessage.order_id == order_id)
        .order_by(CustomerMessage.created_at.desc(), CustomerMessage.id)
        .limit(1)
    )
    if row is None:
        raise HTTPException(404, "No customer message exists for this order")
    return row


@router.get("/orders/{order_id}/customer-message", response_model=CustomerMessageOut)
async def get_customer_message(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(commercial_reader),
):
    return await latest_message(session, order_id)


@router.post("/orders/{order_id}/customer-message/sent", response_model=CustomerMessageOut)
async def mark_message_sent(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    order = await workflow.lock_order(session, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    message = await latest_message(session, order_id)
    if message.status == "draft":
        before = {"status": message.status, "order_status": order.status}
        message.status, message.sent_by, message.sent_at = "sent_by_sales", user.id, datetime.now(UTC)
        # Only the workflow changes order status. A confirmation reply moves the order on; a decline or
        # counter-offer reply does not (the order stays DECLINED or WAITING_CUSTOMER).
        run = await workflow.find_run(session, order.id)
        if run is not None and run.state == "REPLY_DRAFTED":
            await workflow.transition(session, order, run, "CUSTOMER_REPLIED")
        await write_audit(
            session,
            user,
            "mark_sent",
            "customer_messages",
            message.id,
            before,
            {"status": message.status, "order_status": order.status, "order_id": str(order.id)},
        )
        await session.commit()
    return message


class CancelIn(BaseModel):
    reason: str


class CustomerAnswerIn(BaseModel):
    accepted: bool
    comment: str | None = None


async def locked_run(session: AsyncSession, order_id: UUID) -> tuple[Order, WorkflowRun]:
    order = await workflow.lock_order(session, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    run = await workflow.find_run(session, order.id)
    if run is None:
        run = WorkflowRun(order_id=order.id, state=order.status, attempts={})
        session.add(run)
    return order, run


@router.post("/orders/{order_id}/cancel", response_model=OrderSummary)
async def cancel_order(
    order_id: UUID,
    body: CancelIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_roles("manager", "sales")),
):
    """Stop an order and free its stock holds, machine time and draft purchase requests."""
    reason = body.reason.strip()
    if not reason or len(reason) > 500:
        raise HTTPException(422, "Give a reason of 1 to 500 characters")
    order, run = await locked_run(session, order_id)
    if order.status in CLOSED_ORDER_STATES:
        raise HTTPException(409, f"The order is already {order.status}")
    if order.status == "IN_PRODUCTION" and user.role != "manager" and user.role != "admin":
        raise HTTPException(403, "Only a manager can cancel an order in production")
    await workflow.cancel(session, order, run, reason)
    await write_audit(session, user, "cancel_order", "orders", order.id, None, {"reason": reason})
    await session.commit()
    return summary(order, None, False)


@router.post("/orders/{order_id}/retry", response_model=OrderSummary)
async def retry_order(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_roles("manager")),
):
    """Run the failed step of a FAILED order again."""
    order, run = await locked_run(session, order_id)
    try:
        await workflow.retry_failed(session, order, run)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    await write_audit(session, user, "retry_order", "orders", order.id, None, {"state": run.state})
    await session.commit()
    return summary(order, None, False)


@router.post("/orders/{order_id}/customer-answer", response_model=OrderSummary)
async def customer_answer(
    order_id: UUID,
    body: CustomerAnswerIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    """Record the customer's answer to a counter-offer (a later delivery date)."""
    order, run = await locked_run(session, order_id)
    try:
        await workflow.customer_answer(session, order, run, body.accepted, body.comment)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    await write_audit(
        session,
        user,
        "customer_answer",
        "orders",
        order.id,
        None,
        {"accepted": body.accepted, "comment": body.comment},
    )
    await session.commit()
    return summary(order, None, False)


@router.post("/orders/{order_id}/release-intake", response_model=OrderSummary)
async def release_intake(
    order_id: UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(sales_only),
):
    """Sales checked a PO email from an unknown sender: let the order agent read it."""
    order = await workflow.lock_order(session, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status != "SENDER_REVIEW":
        raise HTTPException(409, "This order is not waiting for a sender check")
    order.status = "RECEIVED"
    await stage_event(
        session, order.id, "event.order.received", from_agent="api", document_id=order.source_document_id
    )
    await write_audit(session, user, "release_intake", "orders", order.id, None, {"status": "RECEIVED"})
    await session.commit()
    await flush_events(order.id, retry=True)
    return summary(order, None, False)
