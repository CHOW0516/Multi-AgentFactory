import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.main import discover_routers

REQUIRED_KEYS = ["JWT_SECRET", "ADMIN_EMAIL", "ADMIN_INITIAL_PASSWORD", "DATABASE_URL", "RABBITMQ_URL"]


@pytest.mark.parametrize("missing_key", REQUIRED_KEYS)
def test_missing_required_env_key_stops_start(monkeypatch, missing_key):
    monkeypatch.delenv(missing_key, raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_router_discovery_picks_up_new_module():
    from pathlib import Path

    import app.api as api_package

    probe = Path(api_package.__path__[0]) / "zz_discovery_probe.py"
    probe.write_text("from fastapi import APIRouter\nrouter = APIRouter()\n")
    try:
        names = [name for name, _router in discover_routers()]
        assert "zz_discovery_probe" in names
        assert {"auth", "master_data", "settings"} <= set(names)
    finally:
        probe.unlink()


async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": True, "app_mode": "demo"}
