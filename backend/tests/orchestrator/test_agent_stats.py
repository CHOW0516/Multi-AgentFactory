"""Agent-map polling must aggregate once, while preserving role-specific metrics."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.api.agents import agent_catalog
from app.core.db import get_engine
from app.models import AgentMessage, LlmCall


@pytest.mark.parametrize("role", ["manager", "store"])
async def test_agent_stats_metrics_and_query_budget(db_session, client, auth_headers, role):
    now = datetime.now(UTC)

    def message(kind, sender, recipient=None, **values):
        return AgentMessage(
            message_id=uuid.uuid4(),
            message_type=kind,
            from_agent=sender,
            to_agent=recipient,
            action="test",
            sent_at=now,
            **values,
        )

    done = message(
        "result",
        "planning",
        status="ok",
        latency_ms=100,
        tokens_in=10,
        tokens_out=20,
        cost_usd=Decimal("0.1"),
    )
    failed = message(
        "result",
        "planning",
        status="failed",
        latency_ms=300,
        tokens_in=30,
        tokens_out=40,
        cost_usd=Decimal("0.2"),
    )
    answered = message("task", "orchestrator", "planning")
    pending = message("task", "orchestrator", "planning")
    expired = message("task", "orchestrator", "planning")
    expired.sent_at = now - timedelta(days=2)
    done.in_reply_to = answered.message_id
    old = message("result", "planning", status="ok", tokens_in=999)
    old.sent_at = now - timedelta(days=2)
    db_session.add_all(
        [
            done,
            failed,
            answered,
            pending,
            expired,
            old,
            LlmCall(purpose="orchestrator", model="test", tokens_in=7, tokens_out=8, cost_usd=Decimal("0.5")),
        ]
    )
    await db_session.commit()
    headers = auth_headers(role)
    statements = []

    def count_sql(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = get_engine().sync_engine
    event.listen(engine, "before_cursor_execute", count_sql)
    try:
        response = await client.get("/api/agents", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", count_sql)
    assert response.status_code == 200, response.text
    rows = {row["name"]: row for row in response.json()}
    assert set(rows) == set(agent_catalog())
    planning = rows["planning"]
    assert planning["success_rate_today"] == 50
    assert planning["average_latency_ms"] == 200
    assert planning["tokens_today"] == 100
    assert planning["in_progress"] == 1
    assert float(planning["cost_today_usd"]) == (0 if role == "store" else 0.3)
    assert datetime.fromisoformat(planning["last_seen"]) == now
    assert rows["orchestrator"]["tokens_today"] == 15
    assert float(rows["orchestrator"]["cost_today_usd"]) == (0 if role == "store" else 0.5)
    assert rows["material"]["success_rate_today"] == rows["material"]["tokens_today"] == 0
    assert rows["material"]["last_seen"] is None
    print(f"agent list database statements: {len(statements)}")
    assert len(statements) <= 5  # Authentication plus four aggregates, regardless of agent count.
    single = await client.get("/api/agents/planning", headers=headers)
    assert single.json() == planning
