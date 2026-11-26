import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select

from app.agents.planning.confidence import as_dict, confidence_for_option
from app.core.audit import write_audit
from app.core.db import get_session
from app.core.security import current_user
from app.models import (
    Approval,
    Customer,
    CustomerMessage,
    ExtractedField,
    Order,
    OrderLine,
    Part,
    PlanOption,
    Quotation,
    ScheduleSlot,
    User,
)
from app.orchestrator.read_models import material_status, schedule_rows
from app.orchestrator.workflow import apply_decision, find_run, lock_order
from app.schemas.api import (
    ApprovalDecisionIn,
    ApprovalPack,
    ApprovalSummary,
    PlanOptionOut,
    QuotationComparison,
)

router = APIRouter(tags=["approvals"])


async def allowed(session, user, row, *, read=False):
    if user.role == "manager" or (read and user.role == "admin"):
        return True
    primary = await session.get(User, row.approver_id) if row.approver_id else None
    return bool(row.escalated_at and primary and primary.backup_approver_id == user.id)


def summary(row, order, name):
    return ApprovalSummary(
        id=row.id,
        order_id=order.id,
        order_number=order.order_number,
        customer_name=name,
        approval_type=row.approval_type,
        status=row.status,
        due_date=order.due_date,
        waiting_since=row.created_at,
        reminded=row.reminded_at is not None,
    )


def approval_query():
    return (
        select(Approval, Order, Customer.name)
        .select_from(Approval)
        .join(Order, Approval.order_id == Order.id)
        .outerjoin(Customer, Order.customer_id == Customer.id)
    )


async def get_row(session, approval_id):
    record = (await session.execute(approval_query().where(Approval.id == approval_id))).one_or_none()
    if record is None:
        raise HTTPException(404, "Approval not found")
    return record


@router.get("/approvals", response_model=list[ApprovalSummary])
async def inbox(status: str = "waiting", session=Depends(get_session), user=Depends(current_user)):
    query = approval_query().order_by(Order.due_date.asc().nulls_last(), Approval.created_at)
    if status != "all":
        query = query.where(Approval.status == status)
    return [
        summary(row, order, name)
        for row, order, name in await session.execute(query)
        if await allowed(session, user, row, read=True)
    ]


async def options_for(session, row, run):
    query = select(PlanOption).where(PlanOption.order_id == row.order_id)
    if run and (run.attempts or {}).get("approval_id") == str(row.id):
        ids = [uuid.UUID(value) for value in run.attempts.get("option_ids", [])]
        query = query.where(PlanOption.id.in_(ids))
    return list(
        await session.scalars(query.order_by(PlanOption.is_recommended.desc(), PlanOption.finish_date))
    )


async def compare_quote(session, order):
    quote = await session.get(Quotation, order.quotation_id) if order.quotation_id else None
    if quote is None:
        return []
    part = await session.get(Part, quote.part_id)
    line = await session.scalar(
        select(OrderLine)
        .where(OrderLine.order_id == order.id)
        .order_by((OrderLine.part_id == quote.part_id).desc(), OrderLine.line_number)
        .limit(1)
    )
    comparisons = {
        "due_date": (order.due_date, quote.quoted_due_date),
        "quantity": (line.quantity if line else None, quote.quantity),
        "unit_price": (line.unit_price if line else None, quote.unit_price),
        "revision": (line.revision_text if line else None, part.revision if part else None),
    }
    return [
        QuotationComparison(
            field=field,
            po_value=str(po) if po is not None else None,
            quote_value=str(expected) if expected is not None else None,
            matches=po == expected,
        )
        for field, (po, expected) in comparisons.items()
    ]


@router.get("/approvals/{approval_id}", response_model=ApprovalPack)
async def pack(approval_id: uuid.UUID, session=Depends(get_session), user=Depends(current_user)):
    row, order, name = await get_row(session, approval_id)
    if not await allowed(session, user, row, read=True):
        raise HTTPException(403, "This approval is restricted")
    fields = list(
        await session.scalars(
            select(ExtractedField)
            .where(ExtractedField.order_id == order.id)
            .order_by(ExtractedField.field_name)
        )
    )
    options = await options_for(session, row, await find_run(session, order.id))
    impacted = {uuid.UUID(str(item["order_id"])) for option in options for item in option.impacted_orders}
    gantt = await schedule_rows(
        session,
        or_(
            (ScheduleSlot.order_id == order.id)
            & or_(
                ScheduleSlot.plan_option_id.in_([option.id for option in options]),
                ScheduleSlot.status != "tentative",
            ),
            (ScheduleSlot.order_id.in_(impacted)) & (ScheduleSlot.status != "tentative"),
        ),
    )
    draft = await session.scalar(
        select(CustomerMessage)
        .where(CustomerMessage.order_id == order.id, CustomerMessage.status == "draft")
        .order_by(CustomerMessage.created_at.desc())
        .limit(1)
    )
    return ApprovalPack(
        **summary(row, order, name).model_dump(),
        document_url=f"/orders/{order.id}/document" if order.source_document_id else None,
        fields=fields,
        quotation_comparison=await compare_quote(session, order),
        material=await material_status(session, order.id),
        plan_options=[
            PlanOptionOut.model_validate(
                PlanOptionOut.model_validate(option).model_dump()
                | {"confidence": as_dict(await confidence_for_option(session, option, order))}
            )
            for option in options
        ],
        gantt_slots=gantt,
        customer_message=draft,
        what_changed=row.what_changed,
    )


@router.post("/approvals/{approval_id}/decision")
async def decide(
    approval_id: uuid.UUID, body: ApprovalDecisionIn, session=Depends(get_session), user=Depends(current_user)
):
    initial, _, _ = await get_row(session, approval_id)
    order = await lock_order(session, initial.order_id)
    await session.refresh(initial)
    if not await allowed(session, user, initial):
        raise HTTPException(403, "Only managers or the escalated backup can decide")
    run = await find_run(session, order.id)
    if initial.status != "waiting" or not run or run.attempts.get("approval_id") != str(initial.id):
        raise HTTPException(409, "Approval has already been resolved or superseded")
    if body.decision == "question":
        await write_audit(
            session,
            user,
            "approval_question",
            "order",
            order.id,
            after={"approval_id": str(approval_id), "comment": body.comment},
        )
        await session.commit()
        return {"status": "waiting", "order_id": order.id}
    if body.decision == "reject" and not body.reject_reason:
        raise HTTPException(422, "Rejection requires a reason")
    choices = await options_for(session, initial, run)
    option = next((choice for choice in choices if choice.id == body.chosen_option_id), None)
    if body.chosen_option_id and option is None:
        raise HTTPException(422, "Choose an option from this approval")
    if body.decision == "choose_option" and option is None:
        raise HTTPException(422, "An option is required")
    if body.decision == "approve" and option is None:
        option = next((choice for choice in choices if choice.is_recommended), None)
        if option is None:
            raise HTTPException(422, "Choose an option to approve")
    if body.decision == "reject" and body.reject_reason == "counter_offer":
        later = [
            choice for choice in choices if order.due_date is None or choice.finish_date > order.due_date
        ]
        option = option or (later[0] if later else None)
        if option is None or option not in later:
            raise HTTPException(422, "A later option is required for a counter-offer")
    if body.decision == "reject" and body.reject_reason != "counter_offer":
        option = None
    initial.status, initial.decided_at, initial.approver_id = "decided", datetime.now(UTC), user.id
    initial.decision, initial.comment = body.decision, body.comment
    initial.reject_reason = body.reject_reason if body.decision == "reject" else None
    initial.chosen_option_id = option.id if option else None
    await write_audit(
        session,
        user,
        "approval_decision",
        "order",
        order.id,
        {"status": "waiting"},
        {
            "approval_id": str(approval_id),
            "decision": initial.decision,
            "reason": initial.reject_reason,
            "comment": initial.comment,
            "option_id": str(option.id) if option else None,
        },
    )
    await apply_decision(session, order, run, initial)
    await session.commit()
    return {"status": "decided", "order_id": order.id, "state": run.state}
