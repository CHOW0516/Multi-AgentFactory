from decimal import Decimal

import pytest
from sqlalchemy import select

from app.llm import DailyCostLimitReached, LlmRefused, call_claude
from app.llm.pricing import cost_usd
from app.models import AppSetting, LlmCall


def test_cost_calculation():
    assert cost_usd("claude-opus-5-5", 1_000_000, 1_000_000) == Decimal("24")
    assert cost_usd("claude-haiku-5-5", 2_000_000, 0) == Decimal("0.2")


async def test_call_records_cost_and_parses_json(fake_claude, db_session):
    fake_claude.add_response(text='{"answer": 42}', tokens_in=500, tokens_out=100)
    result = await call_claude(
        "extraction",
        [{"role": "user", "content": "x"}],
        response_schema={"type": "object", "properties": {"answer": {"type": "integer"}}},
    )
    assert result.data == {"answer": 42}
    request = fake_claude.requests[0]
    assert request["model"] == "claude-sonnet-5-5"
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert request["fallbacks"] == "default"
    row = await db_session.scalar(select(LlmCall))
    assert row.purpose == "extraction" and row.tokens_in == 500


async def test_daily_limit_blocks_non_critical_calls(fake_claude, db_session):
    db_session.add(AppSetting(key="llm_daily_cost_limit_usd", value="0.001"))
    db_session.add(
        LlmCall(
            purpose="explain",
            model="claude-opus-5-5",
            tokens_in=1000,
            tokens_out=0,
            cost_usd=Decimal("0.004"),
        )
    )
    await db_session.commit()
    with pytest.raises(DailyCostLimitReached):
        await call_claude("explain", [{"role": "user", "content": "x"}])
    fake_claude.add_response(text="still works")
    result = await call_claude("extraction", [{"role": "user", "content": "x"}])
    assert result.text == "still works"


async def test_refusal_raises(fake_claude):
    fake_claude.add_response(stop_reason="refusal")
    with pytest.raises(LlmRefused):
        await call_claude("orchestrator", [{"role": "user", "content": "x"}])


async def test_haiku_has_no_fallback(fake_claude):
    fake_claude.add_response(text="hi")
    await call_claude("explain", [{"role": "user", "content": "x"}])
    assert "fallbacks" not in fake_claude.requests[0]
