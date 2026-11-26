"""One atomic, revision-checked write boundary for the complete floor draft."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.core.audit import write_audit
from app.core.db import get_session
from app.core.security import current_user, require_roles
from app.floor import CELL, read_layout, validate_layout
from app.models import FloorLayout, FloorPlacement, Machine
from app.schemas.floor import LayoutIn, LayoutOut

router = APIRouter(tags=["floor"])


@router.get("/floor/layout", response_model=LayoutOut)
async def get_layout(session=Depends(get_session), user=Depends(current_user)):
    return await read_layout(session)


@router.put("/floor/layout", response_model=LayoutOut)
async def save_layout(body: LayoutIn, session=Depends(get_session), user=Depends(require_roles("admin"))):
    # Also serializes the very first save, before a singleton row exists.
    await session.execute(text("SELECT pg_advisory_xact_lock(78301420)"))
    previous = await read_layout(session)
    if body.revision != previous.revision:
        raise HTTPException(409, "The floor changed in another session. Your draft is kept; cancel and reload to use the newer layout.")
    if (body.origin_x, body.origin_y) != (previous.origin_x, previous.origin_y):
        raise HTTPException(422, "The floor origin cannot change")
    errors = validate_layout(body)
    if errors:
        raise HTTPException(422, "; ".join(errors[:12]))
    machines = {m.id: m for m in await session.scalars(select(Machine).order_by(Machine.id).with_for_update())}
    codes = {m.code: m.id for m in machines.values()}
    for item in body.machines:
        if item.code in codes and codes[item.code] != item.id:
            raise HTTPException(409, f"Machine code {item.code} is already registered")
    try:
        layout = await session.scalar(select(FloorLayout).where(FloorLayout.singleton == 1))
        if layout is None:
            layout = FloorLayout(origin_x=body.origin_x, origin_y=body.origin_y)
            session.add(layout)
        layout.revision = previous.revision + 1
        layout.columns, layout.rows = body.columns, body.rows
        layout.decor = [item.model_dump(mode="json") for item in body.decor]
        await session.execute(delete(FloorPlacement))
        for item in body.machines:
            machine = machines.get(item.id)
            if machine is None:
                machine = Machine(id=item.id, status="idle")
                session.add(machine)
            elif machine.original_floor_x is None:
                machine.original_floor_x, machine.original_floor_y = machine.floor_x, machine.floor_y
            machine.code, machine.name, machine.machine_type = item.code, item.name, item.machine_type
            machine.floor_x = body.origin_x + item.x * CELL
            machine.floor_y = body.origin_y + item.y * CELL
        await session.flush()
        session.add_all([FloorPlacement(machine_id=item.id, x=item.x, y=item.y, rotation=item.rotation)
                         for item in body.machines])
        await session.flush()
        await write_audit(session, user, "save_floor", "floor_layout", layout.id,
                          before=previous.model_dump(mode="json", exclude={"catalog"}),
                          after=body.model_dump(mode="json") | {"revision": layout.revision})
        # Build the response before commit, so response preparation cannot fail after a successful write.
        result = await read_layout(session)
        await session.commit()
        return result
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(409, "The layout could not be saved because a machine code or reference conflicts") from error
    except Exception:
        await session.rollback()
        raise
