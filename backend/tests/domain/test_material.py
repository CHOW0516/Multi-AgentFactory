import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select

from app.agents.material.__main__ import handle
from app.agents.material.service import (
    check_and_hold,
    confirm_holds,
    expire_holds,
    forecast,
    recheck_holds,
    release_holds,
)
from app.core.db import session_scope
from app.models import AuditLog, BomLine, StockHold, Supplier, SupplierItem
from app.schemas.envelope import Envelope


async def set_bom(db_session, catalog, quantity=1, scrap=0):
    db_session.add(
        BomLine(
            part_id=catalog.part.id,
            material_id=catalog.material.id,
            quantity_per_part=quantity,
            scrap_rate=scrap,
        )
    )
    await db_session.commit()


async def test_two_orders_cannot_reserve_the_same_stock(catalog, make_order, make_stock, db_session):
    await set_bom(db_session, catalog)
    order_a, order_b = await make_order(), await make_order()
    await make_stock(10)

    async def reserve(order_id):
        async with session_scope() as session:
            return await check_and_hold(session, order_id)

    results = await asyncio.gather(reserve(order_a.id), reserve(order_b.id))
    assert sorted(len(result.hold_ids) for result in results) == [0, 1]
    assert await db_session.scalar(select(func.sum(StockHold.quantity))) == 10


async def test_same_task_does_not_create_duplicate_holds(catalog, make_order, make_stock, db_session):
    await set_bom(db_session, catalog)
    order = await make_order()
    await make_stock(10)
    task = Envelope(
        message_id=uuid4(),
        type="task",
        from_agent="orchestrator",
        to_agent="material",
        action="check_and_hold",
        order_id=order.id,
        payload={"order_id": str(order.id)},
    )
    await handle(task)
    await handle(task)
    assert await db_session.scalar(select(func.count()).select_from(StockHold)) == 1
    entries = await db_session.scalars(select(AuditLog).where(AuditLog.action == "check_and_hold"))
    assert len(entries.all()) == 1


async def test_expiry_frees_stock_and_invalidates_a_recheck(catalog, make_order, make_stock, db_session):
    await set_bom(db_session, catalog)
    order = await make_order()
    await make_stock(10)
    result = await check_and_hold(db_session, order.id)
    hold = await db_session.get(StockHold, result.hold_ids[0])
    hold.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()
    assert not (await recheck_holds(db_session, order.id)).valid
    assert await expire_holds(db_session) == 1
    await db_session.commit()
    available = await forecast(db_session, {catalog.material.id: Decimal(10)})
    assert available.needs[0].available == 10
    assert await db_session.scalar(select(AuditLog.id).where(AuditLog.action == "expire_hold"))


async def test_shortage_without_supplier_has_unknown_ready_date(catalog, make_order, make_stock, db_session):
    await set_bom(db_session, catalog, quantity=2)
    order = await make_order()
    await make_stock(1)
    result = await check_and_hold(db_session, order.id)
    assert result.shortages and result.shortages[0].arrives is None
    assert result.material_ready_date is None


async def test_bom_scrap_and_shortest_supplier_lead_time(catalog, make_order, make_stock, db_session):
    await set_bom(db_session, catalog, quantity=2, scrap=Decimal("0.1"))
    order = await make_order()
    await make_stock(15)
    fast, slow = Supplier(name="Fast"), Supplier(name="Slow")
    db_session.add_all([fast, slow])
    await db_session.flush()
    db_session.add_all(
        [
            SupplierItem(supplier_id=fast.id, material_id=catalog.material.id, lead_time_days=2),
            SupplierItem(supplier_id=slow.id, material_id=catalog.material.id, lead_time_days=5),
        ]
    )
    await db_session.commit()
    result = await check_and_hold(db_session, order.id)
    (shortage,) = result.shortages
    assert shortage.short_qty == 7
    assert result.material_ready_date == shortage.arrives
    assert (await recheck_holds(db_session, order.id)).valid
    await confirm_holds(db_session, order.id)
    await db_session.flush()
    held = await db_session.get(StockHold, result.hold_ids[0])
    assert held.hold_type == "firm" and held.expires_at is None and held.quantity == 15
    await release_holds(db_session, order.id)
    await db_session.flush()
    assert await db_session.scalar(select(func.count()).select_from(StockHold)) == 0
