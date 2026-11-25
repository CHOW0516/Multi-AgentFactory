"""Database projections shared by the approval pack and read-only chat tools."""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, or_, select

from app.models import (
    AgentMessage,
    BomLine,
    Material,
    Order,
    OrderLine,
    ScheduleSlot,
    StockHold,
    StockMovement,
)
from app.schemas.api import MaterialNeed, MaterialStatusOut, ScheduleSlotOut


async def material_status(session, order_id):
    result = await session.scalar(
        select(AgentMessage)
        .where(
            AgentMessage.order_id == order_id,
            AgentMessage.action == "check_and_hold",
            AgentMessage.message_type == "result",
            AgentMessage.status.in_(("ok", "partial")),
        )
        .order_by(AgentMessage.sent_at.desc())
        .limit(1)
    )
    data = result.payload if result else {}
    shortages = {str(item["material_id"]): item for item in data.get("shortages", [])}
    needs = func.sum(OrderLine.quantity * BomLine.quantity_per_part * (1 + BomLine.scrap_rate))
    materials = (
        await session.execute(
            select(Material, needs)
            .join(BomLine, BomLine.material_id == Material.id)
            .join(OrderLine, OrderLine.part_id == BomLine.part_id)
            .where(OrderLine.order_id == order_id)
            .group_by(Material.id)
            .order_by(Material.code)
        )
    ).all()
    now = datetime.now(UTC)
    rows = []
    for material, needed in materials:
        stock = await session.scalar(
            select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                StockMovement.material_id == material.id
            )
        )
        holds = await session.scalars(
            select(StockHold).where(
                StockHold.material_id == material.id,
                or_(StockHold.hold_type == "firm", StockHold.expires_at > now),
            )
        )
        own = other = Decimal(0)
        for hold in holds:
            if hold.order_id == order_id:
                own += hold.quantity
            else:
                other += hold.quantity
        available = max(stock - other, Decimal(0))
        rows.append(
            MaterialNeed(
                material_id=material.id,
                material_code=material.code,
                material_name=material.name,
                unit=material.unit,
                needed=needed,
                available=available,
                held=own,
                short=max(needed - available, Decimal(0)),
                arrives=shortages.get(str(material.id), {}).get("arrives"),
                last_counted_at=material.last_counted_at,
            )
        )
    return MaterialStatusOut(
        material_ready_date=data.get("material_ready_date"),
        hold_expires_at=data.get("hold_expires_at"),
        needs=rows,
        data_warnings=data.get("data_warnings", []),
    )


async def schedule_rows(session, *filters, limit=500):
    records = await session.execute(
        select(ScheduleSlot, Order.order_number)
        .join(Order)
        .where(*filters)
        .order_by(ScheduleSlot.start_at, ScheduleSlot.id)
        .limit(limit)
    )
    return [
        ScheduleSlotOut(
            id=slot.id,
            order_id=slot.order_id,
            order_number=number,
            machine_id=slot.machine_id,
            routing_step=slot.routing_step,
            quantity=slot.quantity,
            start_at=slot.start_at,
            end_at=slot.end_at,
            status=slot.status,
            is_overtime=slot.is_overtime,
        )
        for slot, number in records
    ]
