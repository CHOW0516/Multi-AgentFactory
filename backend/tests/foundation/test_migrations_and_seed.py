from sqlalchemy import func, select, text

from app.models import Machine, Material, Order, Part, StockMovement, User
from app.simulator.seed import seed
from tests.conftest import run_alembic


async def test_migrations_go_down_and_up(db_session):
    await db_session.close()
    run_alembic("downgrade", "base")
    run_alembic("upgrade", "head")
    version = await db_session.scalar(text("SELECT version_num FROM alembic_version"))
    assert version == "0004"


async def test_seed_creates_demo_factory(db_session):
    counts = await seed(reset=True)
    assert counts["machines"] == 8
    assert await db_session.scalar(select(func.count()).select_from(Machine)) == 8
    assert await db_session.scalar(select(func.count()).select_from(Part)) == 40
    assert await db_session.scalar(select(func.count()).select_from(Material)) == 30
    assert await db_session.scalar(select(func.count()).select_from(Order)) == 60
    roles = set((await db_session.scalars(select(User.role))).all())
    assert roles == {"admin", "manager", "sales", "planner", "store", "qc"}
    stock_rows = await db_session.execute(
        select(StockMovement.material_id, func.sum(StockMovement.quantity)).group_by(
            StockMovement.material_id
        )
    )
    assert all(total >= 0 for _material, total in stock_rows)


async def test_seed_refuses_when_data_exists(users):
    import pytest

    with pytest.raises(RuntimeError):
        await seed()


async def test_demo_reset_endpoint_is_admin_only_and_reseeds(client, auth_headers, monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    assert (await client.post("/api/demo/reset", headers=auth_headers("manager"))).status_code == 403
    monkeypatch.setattr(settings, "app_mode", "production")
    assert (await client.post("/api/demo/reset", headers=auth_headers("admin"))).status_code == 403
    monkeypatch.undo()
    reset = await client.post("/api/demo/reset", headers=auth_headers("admin"))
    assert reset.status_code == 200, reset.text
    assert reset.json()["machines"] == 8
