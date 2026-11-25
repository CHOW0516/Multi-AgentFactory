"""Draft customer wording around facts computed from the selected option."""

import logging
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.llm.client import DailyCostLimitReached, LlmRefused, LlmUnavailable, call_ai
from app.models import CustomerMessage, Order, OrderLine, PlanOption
from app.schemas.contracts import DraftCustomerReplyResult

logger = logging.getLogger(__name__)


async def draft_customer_reply(
    session: AsyncSession, order_id: UUID, plan_option_id: UUID | None
) -> DraftCustomerReplyResult:
    order = await session.get(Order, order_id, with_for_update={"key_share": True})
    if order is None:
        raise ValueError("Order not found")
    existing = await session.scalar(
        select(CustomerMessage)
        .where(
            CustomerMessage.order_id == order_id,
            CustomerMessage.plan_option_id == plan_option_id,
        )
        .order_by(CustomerMessage.created_at.desc())
        .limit(1)
    )
    if existing:
        return DraftCustomerReplyResult(customer_message_id=existing.id)

    reference = (order.po_number or order.order_number).replace("\r", " ").replace("\n", " ")
    if plan_option_id is None:
        scenario, facts = "decline", f"We are unable to accept purchase order {reference}."
    else:
        option = await session.get(PlanOption, plan_option_id)
        if option is None or option.order_id != order_id:
            raise ValueError("Plan option not found for this order")
        if option.option_type == "split":
            if option.split_quantity_first is None or option.split_finish_date_first is None:
                raise ValueError("Split option is missing its first delivery quantity or date")
            first_quantity = Decimal(option.split_quantity_first)
            total = await session.scalar(
                select(func.sum(OrderLine.quantity)).where(OrderLine.order_id == order_id)
            )
            if total is None or not 0 < first_quantity < total:
                raise ValueError("Split option quantity does not match the order")
            scenario = "split delivery"
            facts = (
                f"For purchase order {reference}, we can deliver {first_quantity.normalize():f} "
                f"by {option.split_finish_date_first:%d %B %Y} and the remaining "
                f"{(total - first_quantity).normalize():f} by {option.finish_date:%d %B %Y}."
            )
        elif order.due_date is not None and option.finish_date > order.due_date:
            scenario = "propose a new date"
            facts = f"We can deliver purchase order {reference} by {option.finish_date:%d %B %Y}."
        else:
            scenario = "confirm"
            facts = f"We confirm delivery of purchase order {reference} by {option.finish_date:%d %B %Y}."

    opening = "Thank you for your purchase order."
    try:
        response = await call_ai(
            "order",
            "explain",
            [
                {
                    "role": "user",
                    "content": f"Write a brief, polite opening thanking a customer. Context: {scenario}.",
                }
            ],
            system="Return one short sentence of courtesy only. Include no dates, quantities, names or promises.",
            order_id=order_id,
        )
        sentence = response.text.strip()
        if (
            sentence
            and len(sentence) <= 180
            and not any(char.isdigit() for char in sentence)
            and "\n" not in sentence
        ):
            opening = sentence
    except (LlmUnavailable, DailyCostLimitReached, LlmRefused):
        logger.info("Using default customer reply wording for order %s", order_id)
    message = CustomerMessage(
        order_id=order_id,
        plan_option_id=plan_option_id,
        subject=f"Purchase order {reference}",
        draft_text=f"Hello,\n\n{opening}\n\n{facts}\n\nBest regards,\nSales",
        status="draft",
    )
    session.add(message)
    await session.flush()
    await write_audit(
        session,
        "order",
        "draft_customer_reply",
        "customer_messages",
        message.id,
        None,
        {"order_id": str(order_id), "status": "draft"},
    )
    return DraftCustomerReplyResult(customer_message_id=message.id)


async def close_order(session: AsyncSession, order_id: UUID) -> None:
    order = await session.get(Order, order_id, with_for_update=True)
    if order is None:
        raise ValueError("Order not found")
    if order.status != "COMPLETED":
        before = {"status": order.status}
        order.status, order.completed_at = "COMPLETED", datetime.now(UTC)
        await write_audit(
            session,
            "order",
            "close_order",
            "orders",
            order.id,
            before,
            {"status": order.status, "completed_at": order.completed_at.isoformat()},
        )
