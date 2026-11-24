"""One wrapper for every Claude call: model choice, cost logging, and the daily cost limit.

Usage:
    result = await call_claude("extraction", messages=[...], response_schema=MY_JSON_SCHEMA)
    result.text, result.data (parsed JSON when response_schema is given), result.message (raw)

Notes for agent authors:
- Forced tool_choice ("any"/"tool") is not supported on the current models. For structured data use
  `response_schema` (structured outputs). For chat with tools, pass `tools` and loop on tool_use yourself.
- PDFs and images can be sent directly as content blocks; see `document_block` / `image_block`.
"""

import base64
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, time
from decimal import Decimal
from functools import lru_cache
from typing import Any, Literal

import anthropic
from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import session_scope
from app.llm.pricing import cost_usd
from app.llm.usage import add_usage
from app.models import AppSetting, LlmCall

logger = logging.getLogger(__name__)

Purpose = Literal["orchestrator", "extraction", "explain"]
# Purposes that keep working after the daily limit is reached (core order flow).
CRITICAL_PURPOSES: set[str] = {"extraction"}
# Models that support server-side refusal fallbacks.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class DailyCostLimitReached(RuntimeError):
    pass


class LlmRefused(RuntimeError):
    pass


@dataclass
class ClaudeResult:
    message: Any
    text: str
    data: Any | None
    tokens_in: int
    tokens_out: int
    cost_usd: Decimal


@lru_cache
def get_client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)


def model_for(purpose: Purpose) -> str:
    return {
        "orchestrator": settings.llm_model_orchestrator,
        "extraction": settings.llm_model_extraction,
        "explain": settings.llm_model_explain,
    }[purpose]


def document_block(pdf_bytes: bytes) -> dict:
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.b64encode(pdf_bytes).decode(),
        },
    }


def image_block(image_bytes: bytes, media_type: str) -> dict:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64.b64encode(image_bytes).decode(),
        },
    }


async def daily_limit_usd() -> Decimal:
    async with session_scope() as session:
        override = await session.scalar(
            select(AppSetting.value).where(AppSetting.key == "llm_daily_cost_limit_usd")
        )
    return Decimal(override) if override is not None else Decimal(str(settings.llm_daily_cost_limit_usd))


async def spent_today_usd() -> Decimal:
    start_of_day = datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)
    async with session_scope() as session:
        total = await session.scalar(
            select(func.coalesce(func.sum(LlmCall.cost_usd), 0)).where(LlmCall.created_at >= start_of_day)
        )
    return Decimal(total)


async def check_daily_limit(purpose: Purpose) -> None:
    if purpose in CRITICAL_PURPOSES:
        return
    if await spent_today_usd() >= await daily_limit_usd():
        raise DailyCostLimitReached(
            f"LLM daily cost limit reached; '{purpose}' calls are paused until tomorrow"
        )


async def record_call(
    purpose: str,
    model: str,
    order_id: uuid.UUID | None,
    tokens_in: int,
    tokens_out: int,
    stop_reason: str | None,
) -> Decimal:
    call_cost = cost_usd(model, tokens_in, tokens_out)
    async with session_scope() as session:
        session.add(
            LlmCall(
                purpose=purpose,
                model=model,
                order_id=order_id,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=call_cost,
                stop_reason=stop_reason,
            )
        )
    add_usage(tokens_in, tokens_out, call_cost)
    return call_cost


async def call_claude(
    purpose: Purpose,
    messages: list[dict],
    system: str | None = None,
    tools: list[dict] | None = None,
    response_schema: dict | None = None,
    order_id: uuid.UUID | None = None,
    model: str | None = None,
    max_tokens: int | None = None,
    effort: Literal["low", "medium", "high"] | None = None,
) -> ClaudeResult:
    """Call Claude once. Raises DailyCostLimitReached or LlmRefused."""
    await check_daily_limit(purpose)
    chosen_model = model or model_for(purpose)
    request: dict[str, Any] = {
        "model": chosen_model,
        "max_tokens": max_tokens or settings.llm_max_tokens,
        "messages": messages,
    }
    if system:
        request["system"] = system
    if tools:
        request["tools"] = tools
    output_config: dict[str, Any] = {}
    if response_schema:
        output_config["format"] = {"type": "json_schema", "schema": response_schema}
    if effort:
        output_config["effort"] = effort
    if output_config:
        request["output_config"] = output_config

    client = get_client()
    if chosen_model in FALLBACK_MODELS:
        message = await client.beta.messages.create(**request, betas=[FALLBACK_BETA], fallbacks="default")
    else:
        message = await client.messages.create(**request)

    tokens_in = message.usage.input_tokens + (getattr(message.usage, "cache_read_input_tokens", 0) or 0)
    tokens_out = message.usage.output_tokens
    call_cost = await record_call(purpose, chosen_model, order_id, tokens_in, tokens_out, message.stop_reason)

    if message.stop_reason == "refusal":
        raise LlmRefused(f"Claude declined the {purpose} request")

    text = "".join(block.text for block in message.content if getattr(block, "type", None) == "text")
    data = json.loads(text) if response_schema and text else None
    return ClaudeResult(message, text, data, tokens_in, tokens_out, call_cost)
