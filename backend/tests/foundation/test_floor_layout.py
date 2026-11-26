import asyncio
import uuid

import pytest
from sqlalchemy import func, select, text

from app.floor import initial_decor, snap, validate_layout
from app.models import AuditLog, FloorLayout, FloorPlacement, Machine
from app.schemas.floor import LayoutIn
from tests.conftest import run_alembic


async def draft(client, auth_headers):
    response = await client.get("/api/floor/layout", headers=auth_headers("admin"))
    assert response.status_code == 200, response.text
    body = response.json()
    body.pop("catalog")
    return body


def machine(body, **changes):
    return {"id": str(uuid.uuid4()), "code": "LATHE-NEW", "name": "New lathe", "machine_type": "cnc_lathe",
            "x": 45, "y": 37, "rotation": 0} | changes


async def test_layout_permissions_and_legacy_write_boundary(client, auth_headers):
    body = await draft(client, auth_headers)
    for role in ("manager", "planner", "sales", "store", "qc"):
        assert (await client.get("/api/floor/layout", headers=auth_headers(role))).status_code == 200
        assert (await client.put("/api/floor/layout", json=body, headers=auth_headers(role))).status_code == 403
    assert (await client.put("/api/floor/layout", json=body)).status_code == 401
    old = await client.post("/api/machines", json={"code": "X", "name": "X", "machine_type": "cnc_lathe"}, headers=auth_headers("admin"))
    assert old.status_code == 409
    old = await client.patch(f"/api/machines/{uuid.uuid4()}", json={"floor_x": 10}, headers=auth_headers("admin"))
    assert old.status_code == 409


async def test_atomic_layout_keeps_machine_records_and_live_positions(client, auth_headers, db_session):
    body = await draft(client, auth_headers)
    placed = machine(body)
    body["machines"] = [placed]
    headers = auth_headers("admin")
    saved = await client.put("/api/floor/layout", json=body, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    persisted = await db_session.scalar(select(FloorLayout))
    assert isinstance(persisted.id, uuid.UUID)
    assert persisted.created_at is not None and persisted.updated_at is not None
    await db_session.commit()
    live = (await client.get("/api/floor", headers=headers)).json()
    assert len(live["machines"]) == 1
    assert live["machines"][0]["floor_x"] == 300
    assert live["machines"][0]["floor_y"] == 200
    assert live["layout"]["decor"] == body["decor"]
    body["revision"] = 1
    body["machines"][0].update(rotation=90, name="Renamed lathe")
    assert (await client.put("/api/floor/layout", json=body, headers=headers)).status_code == 200
    live = (await client.get("/api/floor", headers=headers)).json()
    assert live["machines"][0]["rotation"] == 90
    body.update(revision=2, machines=[])
    assert (await client.put("/api/floor/layout", json=body, headers=headers)).status_code == 200
    assert (await client.get("/api/floor", headers=headers)).json()["machines"] == []
    registry = (await client.get("/api/machines", headers=headers)).json()
    assert [(row["id"], row["name"]) for row in registry] == [(placed["id"], "Renamed lathe")]
    assert await db_session.scalar(select(func.count()).select_from(Machine)) == 1
    assert await db_session.scalar(select(func.count()).select_from(FloorPlacement)) == 0
    assert await db_session.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "save_floor")) == 3


async def test_layout_rejects_geometry_and_bad_input_without_writing(client, auth_headers, db_session):
    body = await draft(client, auth_headers)
    headers = auth_headers("admin")
    for invalid in [
        body | {"machines": [machine(body), machine(body, code="SECOND")]},
        body | {"machines": [machine(body, x=body["columns"] - 8, rotation=0)]},
        body | {"machines": [machine(body, y=body["rows"] - 8, rotation=90)]},
        body | {"columns": 10},
        body | {"machines": [machine(body, x=1.5)]},
        body | {"machines": [machine(body, name=" ")]},
        body | {"machines": [machine(body, rotation=45)]},
        body | {"decor": [body["decor"][0] | {"width": 1}]},
        body | {"origin_x": 0},
    ]:
        response = await client.put("/api/floor/layout", json=invalid, headers=headers)
        assert response.status_code == 422, response.text
        assert (await draft(client, auth_headers)) == body
    assert await db_session.scalar(select(func.count()).select_from(Machine)) == 0
    assert await db_session.scalar(select(func.count()).select_from(FloorLayout)) == 0


async def test_concurrent_first_save_has_one_winner(client, auth_headers):
    body = await draft(client, auth_headers)
    results = await asyncio.gather(*[client.put("/api/floor/layout", json=body, headers=auth_headers("admin")) for _ in range(2)])
    assert sorted(response.status_code for response in results) == [200, 409]
    assert (await draft(client, auth_headers))["revision"] == 1


async def test_failure_after_flush_rolls_back_all_layout_and_property_changes(client, auth_headers, db_session, monkeypatch):
    from app.api import floor_layout

    body = await draft(client, auth_headers)
    body["machines"] = [machine(body)]
    saved = await client.put("/api/floor/layout", json=body, headers=auth_headers("admin"))
    assert saved.status_code == 200, saved.text
    previous = await draft(client, auth_headers)
    changed = previous | {"columns": previous["columns"] + 20, "decor": []}
    changed["machines"] = [previous["machines"][0] | {"name": "Should roll back", "x": 80}]

    async def fail_audit(*args, **kwargs):
        raise RuntimeError("injected save failure after flush")

    monkeypatch.setattr(floor_layout, "write_audit", fail_audit)
    with pytest.raises(RuntimeError, match="injected save failure"):
        await client.put("/api/floor/layout", json=changed, headers=auth_headers("admin"))
    assert (await draft(client, auth_headers)) == previous
    await db_session.rollback()
    record = await db_session.scalar(select(Machine))
    assert record.name == "New lathe"
    assert record.floor_x == 300


async def test_legacy_migration_preserves_coordinates_and_is_retry_safe(db_session, client, auth_headers):
    from app.models import SimLine

    line = SimLine(name="Existing line", design={"nodes": []})
    db_session.add(line)
    await db_session.commit()
    line_id = line.id
    await db_session.close()
    run_alembic("downgrade", "0002")
    machine_id = uuid.uuid4()
    await db_session.execute(text("INSERT INTO machines (id, code, name, machine_type, status, floor_x, floor_y) "
                                  "VALUES (:id, 'LEGACY', 'Legacy', 'custom_type', 'idle', 123, -25)"), {"id": machine_id})
    await db_session.commit()
    run_alembic("upgrade", "head")
    run_alembic("upgrade", "head")
    row = (await db_session.execute(text("SELECT id, floor_x, floor_y, original_floor_x, original_floor_y FROM machines"))).one()
    assert tuple(row) == (machine_id, 120, -20, 123, -25)
    assert (await db_session.get(SimLine, line_id)).design == {"nodes": []}
    await db_session.commit()
    body = await draft(client, auth_headers)
    placed = body["machines"][0]
    assert placed["id"] == str(machine_id)
    assert body["origin_x"] + placed["x"] * 10 == 120
    assert body["origin_y"] + placed["y"] * 10 == -20


def test_grid_rounding_initial_catalog_and_wall_rules():
    assert [snap(n) for n in (-25, -26, 0, 123, 125)] == [-2, -3, 0, 12, 13]
    body = LayoutIn(revision=0, origin_x=-150, origin_y=-170, columns=137, rows=102, machines=[], decor=initial_decor())
    assert validate_layout(body) == []
    wall = initial_decor()[0].model_dump() | {"kind": "wall", "width": 10, "height": 1, "rotation": 90, "x": 120, "y": 10}
    assert validate_layout(body.model_copy(update={"decor": [type(body.decor[0])(**wall)]})) == []
    wall["height"] = 2
    assert "A wall run must be one cell thick" in validate_layout(body.model_copy(update={"decor": [type(body.decor[0])(**wall)]}))
