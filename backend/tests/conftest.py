"""Shared test fixtures for every area (owned by P1).

Needs a PostgreSQL server. Set TEST_DATABASE_URL (default: postgresql+asyncpg://factory:factory@localhost:5432/factory_test).
The test database is dropped and re-created once per test run, then migrated with Alembic.

Fixtures:
  client                  httpx.AsyncClient for the FastAPI app
  db_session              AsyncSession on the test database
  users                   one User per role: users["manager"], users["sales"], ...
  auth_headers(role)      {"Authorization": "Bearer ..."} for that role's user
  fake_broker             InMemoryBroker installed for app.messaging (autouse; .published records everything)
  fake_claude             FakeClaude installed for app.llm (queue responses with .add_response)
"""

import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://factory:factory@localhost:5432/factory_test"
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-for-hs256-0123")
os.environ.setdefault("ADMIN_EMAIL", "admin@factory.local")
os.environ.setdefault("ADMIN_INITIAL_PASSWORD", "test-password")
os.environ.setdefault("RABBITMQ_URL", "amqp://factory:factory@localhost:5672/")
os.environ.setdefault("APP_MODE", "demo")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.db import get_session_factory  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.messaging import InMemoryBroker, set_broker  # noqa: E402
from app.models import Base, User  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROLES = ("manager", "sales", "planner", "store", "qc", "admin")


def _plain_dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://")


async def _recreate_database() -> None:
    dsn = _plain_dsn(TEST_DATABASE_URL)
    base_dsn, database_name = dsn.rsplit("/", 1)
    connection = await asyncpg.connect(f"{base_dsn}/postgres")
    try:
        await connection.execute(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')
        await connection.execute(f'CREATE DATABASE "{database_name}"')
    finally:
        await connection.close()


def run_alembic(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        check=True,
    )


@pytest.fixture(scope="session", autouse=True)
def test_database() -> None:
    asyncio.run(_recreate_database())
    run_alembic("upgrade", "head")


@pytest.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session


@pytest.fixture(autouse=True)
async def clean_tables() -> AsyncIterator[None]:
    yield
    table_names = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    async with get_session_factory()() as session:
        await session.execute(text(f"TRUNCATE {table_names} CASCADE"))
        await session.commit()


@pytest.fixture(autouse=True)
def fake_broker() -> InMemoryBroker:
    broker = InMemoryBroker()
    set_broker(broker)
    yield broker
    set_broker(None)


@pytest.fixture
async def users(db_session: AsyncSession) -> dict[str, User]:
    password_hash = hash_password("test-password")
    created = {}
    for role in ROLES:
        user = User(name=f"Test {role}", email=f"{role}@test.local", role=role, password_hash=password_hash)
        db_session.add(user)
        created[role] = user
    await db_session.commit()
    return created


@pytest.fixture
def auth_headers(users: dict[str, User]):
    def headers_for(role: str) -> dict[str, str]:
        user = users[role]
        return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}

    return headers_for


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client


class FakeClaude:
    """Stands in for anthropic.AsyncAnthropic. Queue responses with add_response; inspect .requests."""

    def __init__(self) -> None:
        self.responses: list[SimpleNamespace] = []
        self.requests: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def add_response(
        self,
        text: str = "",
        tool_uses: list[dict] | None = None,
        tokens_in: int = 100,
        tokens_out: int = 50,
        stop_reason: str = "end_turn",
    ) -> None:
        content = []
        if text:
            content.append(SimpleNamespace(type="text", text=text))
        for tool_use in tool_uses or []:
            content.append(
                SimpleNamespace(
                    type="tool_use",
                    id=tool_use.get("id", "toolu_1"),
                    name=tool_use["name"],
                    input=tool_use["input"],
                )
            )
        usage = SimpleNamespace(input_tokens=tokens_in, output_tokens=tokens_out, cache_read_input_tokens=0)
        self.responses.append(SimpleNamespace(content=content, usage=usage, stop_reason=stop_reason))

    async def _create(self, **request):
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("FakeClaude has no queued response; call add_response first")
        return self.responses.pop(0)


@pytest.fixture
def fake_claude(monkeypatch) -> FakeClaude:
    import app.llm.client as llm_client

    fake = FakeClaude()
    monkeypatch.setattr(llm_client, "get_client", lambda: fake)
    return fake
