import json
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.llm import (
    DailyCostLimitReached,
    LlmRefused,
    LlmUnavailable,
    call_ai,
    document_block,
    model_for,
    pricing,
)
from app.llm import client as llm_client
from app.models import AppSetting, LlmCall


@pytest.fixture
def ai_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "ai_model", "grafilab/glm-5.3-flash")
    monkeypatch.setattr(settings, "ai_model_orchestrator", "gemini/gemini-3.8-flash")
    monkeypatch.setattr(settings, "ai_model_order", "gemini/gemini-3.8-flash")
    monkeypatch.setattr(settings, "ai_model_planning", "")
    monkeypatch.setattr(settings, "ai_prices", json.dumps({"gemini/gemini-3.8-flash": [1, 4]}))
    pricing.prices.cache_clear()
    yield settings
    pricing.prices.cache_clear()


def test_each_agent_gets_its_own_model_or_the_default(ai_settings):
    assert model_for("orchestrator") == "gemini/gemini-3.8-flash"
    assert model_for("order") == "gemini/gemini-3.8-flash"
    assert model_for("planning") == "grafilab/glm-5.3-flash"  # empty override falls back to AI_MODEL
    assert model_for("quality") == "grafilab/glm-5.3-flash"


def test_cost_uses_prices_from_env_and_zero_for_unknown_models(ai_settings):
    assert pricing.cost_usd("gemini/gemini-3.8-flash", 1_000_000, 1_000_000) == Decimal("5")
    assert pricing.cost_usd("not-priced", 1_000_000, 1_000_000) == Decimal("0")


def test_bad_prices_json_counts_as_zero(ai_settings, monkeypatch):
    monkeypatch.setattr(ai_settings, "ai_prices", "not json")
    pricing.prices.cache_clear()
    assert pricing.cost_usd("gemini/gemini-3.8-flash", 1_000_000, 0) == Decimal("0")


async def test_call_records_cost_and_parses_json(fake_ai, ai_settings, db_session):
    fake_ai.add_response(text='```json\n{"answer": 42}\n```', tokens_in=500, tokens_out=100)
    result = await call_ai(
        "order",
        "extraction",
        [{"role": "user", "content": [document_block(b"%PDF-1.4")]}],
        system="Read the PO.",
        response_schema={"type": "object", "properties": {"answer": {"type": "integer"}}},
    )
    assert result.data == {"answer": 42}
    request = fake_ai.requests[0]
    assert request["model"] == "gemini/gemini-3.8-flash"
    assert request["messages"][0] == {"role": "system", "content": "Read the PO."}
    assert request["messages"][1]["content"][0]["file"]["file_data"].startswith(
        "data:application/pdf;base64,"
    )
    assert request["response_format"]["type"] == "json_schema"
    row = await db_session.scalar(select(LlmCall))
    assert row.purpose == "extraction" and row.tokens_in == 500 and row.model == "gemini/gemini-3.8-flash"
    assert row.cost_usd == Decimal("0.0009")


async def test_tool_round_trip_is_converted(fake_ai, ai_settings):
    fake_ai.add_response(
        tool_uses=[{"id": "call_7", "name": "get_order", "input": {"order": "SO-1"}}], stop_reason="tool_use"
    )
    reply = await call_ai(
        "orchestrator",
        "orchestrator",
        [{"role": "user", "content": "Is SO-1 late?"}],
        tools=[{"name": "get_order", "description": "Read an order", "input_schema": {"type": "object"}}],
    )
    (block,) = reply.message.content
    assert (block.type, block.id, block.name, block.input) == (
        "tool_use",
        "call_7",
        "get_order",
        {"order": "SO-1"},
    )
    assert fake_ai.requests[0]["tools"][0]["function"]["name"] == "get_order"

    fake_ai.add_response(text="On time.")
    await call_ai(
        "orchestrator",
        "orchestrator",
        [
            {"role": "user", "content": "Is SO-1 late?"},
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "call_7", "name": "get_order", "input": {"order": "SO-1"}}
                ],
            },
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_7", "content": "{}"}]},
        ],
    )
    assistant, tool = fake_ai.requests[1]["messages"][1:]
    assert assistant["tool_calls"][0]["function"] == {"name": "get_order", "arguments": '{"order": "SO-1"}'}
    assert tool == {"role": "tool", "tool_call_id": "call_7", "content": "{}"}


async def test_daily_limit_blocks_non_critical_calls(fake_ai, db_session):
    db_session.add(AppSetting(key="llm_daily_cost_limit_usd", value="0.001"))
    db_session.add(
        LlmCall(purpose="explain", model="m", tokens_in=1000, tokens_out=0, cost_usd=Decimal("0.004"))
    )
    await db_session.commit()
    with pytest.raises(DailyCostLimitReached):
        await call_ai("planning", "explain", [{"role": "user", "content": "x"}])
    fake_ai.add_response(text="still works")
    result = await call_ai("order", "extraction", [{"role": "user", "content": "x"}])
    assert result.text == "still works"


async def test_content_filter_raises_refused(fake_ai):
    fake_ai.add_response(stop_reason="refusal")
    with pytest.raises(LlmRefused):
        await call_ai("orchestrator", "orchestrator", [{"role": "user", "content": "x"}])


async def test_provider_error_raises_unavailable(monkeypatch):
    import httpx

    def failing_transport(request):
        return httpx.Response(502, text="bad gateway")

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        llm_client.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(failing_transport), **kwargs),
    )
    with pytest.raises(LlmUnavailable, match="502"):
        await llm_client.post_chat_completion({"model": "m", "messages": []})
