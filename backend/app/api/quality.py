import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.agents.quality import get_plan, get_records, verify
from app.core.audit import write_audit
from app.core.db import get_session
from app.core.security import current_user
from app.models import Order, QcRecord
from app.orchestrator.workflow import lock_order
from app.schemas.api import QcPlanOut, QcRecordIn, QcRecordOut

router = APIRouter(tags=["quality"])


@router.get("/qc/orders/{order_id}")
async def quality_order(order_id: uuid.UUID, session=Depends(get_session), user=Depends(current_user)):
    plan = await get_plan(session, order_id)
    if plan is None:
        if await session.get(Order, order_id) is None:
            raise HTTPException(404, "Order not found")
        return {"plan": None, "records": [], "missing": ["QC plan"]}
    return {
        "plan": QcPlanOut.model_validate(plan),
        "records": [QcRecordOut.model_validate(row) for row in await get_records(session, plan)],
        "missing": await verify(session, order_id),
    }


@router.post("/qc/records", response_model=QcRecordOut, status_code=201)
async def record(body: QcRecordIn, session=Depends(get_session), user=Depends(current_user)):
    if user.role != "qc":
        raise HTTPException(403, "Only quality inspectors can record checks")
    order = await lock_order(session, body.order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status == "COMPLETED":
        raise HTTPException(409, "This order is complete")
    plan = await get_plan(session, order.id)
    if not plan or body.check_name not in {check["name"] for check in plan.checks}:
        raise HTTPException(422, "Select a check from this order's QC plan")
    if body.measured_value is not None and len(body.measured_value) > 120:
        raise HTTPException(422, "Measured value must be at most 120 characters")
    row = QcRecord(**body.model_dump(), qc_plan_id=plan.id, inspector_id=user.id)
    session.add(row)
    await write_audit(
        session, user, "record_qc", "order", order.id, after={"check": body.check_name, "result": body.result}
    )
    await session.commit()
    return row
