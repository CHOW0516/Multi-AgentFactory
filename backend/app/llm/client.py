"""One wrapper for every AI call: model choice per agent, cost logging, and the daily cost limit.

The provider is any OpenAI-compatible endpoint (Grafilab by default), set with AI_BASE_URL and AI_API_KEY.
Each agent can use its own model: AI_MODEL_<AGENT> in .env, falling back to AI_MODEL.

Usage:
    result = await call_ai("order", "extraction", messages=[...], response_schema=MY_JSON_SCHEMA)
    result.text, result.data (parsed JSON when response_schema is given), result.message (normalised reply)

Callers write messages in one simple block format, and this module converts it to the provider's format:
- content is a string, or a list of blocks: {"type": "text"}, `image_block(...)`, `document_block(...)`,
  {"type": "tool_use", id, name, input} (assistant) and {"type": "tool_result", tool_use_id, content} (user).
- tools are {"name", "description", "input_schema"}.
- result.message.content is a list of blocks with .type "text" (.text) or "tool_use" (.id, .name, .input).
"""

import base64
import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, time
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import session_scope
from app.llm.pricing import cost_usd, prices
from app.llm.usage import add_usage
from app.models import AppSetting, LlmCall

logger = logging.getLogger(__name__)

Agent = Literal["orchestrator", "order", "planning", "material", "quality", "maintenance", "monitoring"]
Purpose = Literal["orchestrator", "extraction", "explain"]
# Purposes that keep working after the daily limit is reached (core order flow).
CRITICAL_PURPOSES: set[str] = {"extraction"}
REQUEST_TIMEOUT_SECONDS = 180


class DailyCostLimitReached(RuntimeError):
    pass


class LlmRefused(RuntimeError):
    pass


class LlmUnavailable(RuntimeError):
    """The provider could not be reached or returned an error."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable  # False for 4xx errors (bad request, auth), which repeat on retry


class LlmTruncated(RuntimeError):
    """The reply hit max_tokens, so structured output is incomplete. Retrying gives the same result."""


@dataclass
class AiResult:
    message: Any
    text: str
    data: Any | None
    tokens_in: int
    tokens_out: int
    cost_usd: Decimal


def model_for(agent: Agent) -> str:
    """The agent's own model from AI_MODEL_<AGENT>, or AI_MODEL when that is empty."""
    return getattr(settings, f"ai_model_{agent}", "") or settings.ai_model


def document_block(pdf_bytes: bytes) -> dict:
    return {"type": "document", "media_type": "application/pdf", "data": base64.b64encode(pdf_bytes).decode()}


def image_block(image_bytes: bytes, media_type: str) -> dict:
    return {"type": "image", "media_type": media_type, "data": base64.b64encode(image_bytes).decode()}


# ---------------------------------------------------------------- format conversion
def _content_part(block: dict) -> dict:
    if block["type"] == "text":
        return {"type": "text", "text": block["text"]}
    data_url = f"data:{block['media_type']};base64,{block['data']}"
    # Grafilab rejects "file" parts but reads PDFs sent as an image_url data URL (checked 2026-11-25).
    if block["type"] in ("image", "document"):
        return {"type": "image_url", "image_url": {"url": data_url}}
    raise ValueError(f"Unsupported content block: {block['type']}")


def to_provider_messages(messages: list[dict], system: str | None) -> list[dict]:
    converted: list[dict] = [{"role": "system", "content": system}] if system else []
    for message in messages:
        content = message["content"]
        if isinstance(content, str):
            converted.append({"role": message["role"], "content": content})
            continue
        tool_calls = [
            {
                "id": block["id"],
                "type": "function",
                "function": {"name": block["name"], "arguments": json.dumps(block["input"])},
            }
            for block in content
            if block["type"] == "tool_use"
        ]
        tool_results = [block for block in content if block["type"] == "tool_result"]
        parts = [
            _content_part(block) for block in content if block["type"] not in ("tool_use", "tool_result")
        ]
        if message["role"] == "assistant":
            text = "".join(part["text"] for part in parts if part["type"] == "text")
            entry: dict[str, Any] = {"role": "assistant", "content": text or None}
            if tool_calls:
                entry["tool_calls"] = tool_calls
            converted.append(entry)
            continue
        for result in tool_results:
            converted.append(
                {"role": "tool", "tool_call_id": result["tool_use_id"], "content": result["content"]}
            )
        if parts:
            converted.append({"role": "user", "content": parts})
    return converted


def to_provider_tools(tools: list[dict]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool.get("description", ""),
                "parameters": tool["input_schema"],
            },
        }
        for tool in tools
    ]


def from_provider_reply(reply: dict) -> SimpleNamespace:
    choice = reply["choices"][0]
    message = choice.get("message") or {}
    blocks = []
    if message.get("content"):
        blocks.append(SimpleNamespace(type="text", text=message["content"]))
    for call in message.get("tool_calls") or []:
        arguments = call["function"].get("arguments") or "{}"
        try:
            parsed = json.loads(arguments) if isinstance(arguments, str) else arguments
        except json.JSONDecodeError:
            parsed = {}
        blocks.append(
            SimpleNamespace(type="tool_use", id=call["id"], name=call["function"]["name"], input=parsed)
        )
    return SimpleNamespace(
        content=blocks, stop_reason=choice.get("finish_reason"), usage=reply.get("usage") or {}
    )


def parse_json_text(text: str) -> Any:
    """Models sometimes wrap JSON in ```json fences even when asked for JSON only."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
        cleaned = cleaned.rsplit("```", 1)[0]
    return json.loads(cleaned)


# ---------------------------------------------------------------- provider call
async def post_chat_completion(request: dict) -> dict:
    """POST /chat/completions. Tests replace this function."""
    headers = {"Authorization": f"Bearer {settings.ai_api_key}"} if settings.ai_api_key else {}
    url = settings.ai_base_url.rstrip("/") + "/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(url, json=request, headers=headers)
    except httpx.HTTPError as error:
        raise LlmUnavailable(f"AI provider not reachable: {error}") from error
    if response.status_code >= 400:
        retryable = response.status_code in (408, 409, 429) or response.status_code >= 500
        raise LlmUnavailable(
            f"AI provider returned {response.status_code}: {response.text[:300]}", retryable=retryable
        )
    return response.json()


# ---------------------------------------------------------------- cost limit
async def daily_limit_usd() -> Decimal:
    async with session_scope() as session:
        override = await session.scalar(
            select(AppSetting.value).where(AppSetting.key == "llm_daily_cost_limit_usd")
        )
    return Decimal(override) if override is not None else Decimal(str(settings.llm_daily_cost_limit_usd))


async def spent_today_usd(purposes: set[str] | None = None) -> Decimal:
    """Spend since midnight in the factory's time zone (not UTC), optionally for some purposes only."""
    zone = ZoneInfo(settings.app_timezone)
    start_of_day = datetime.combine(datetime.now(zone).date(), time.min, tzinfo=zone)
    query = select(func.coalesce(func.sum(LlmCall.cost_usd), 0)).where(LlmCall.created_at >= start_of_day)
    if purposes:
        query = query.where(LlmCall.purpose.in_(purposes))
    async with session_scope() as session:
        total = await session.scalar(query)
    return Decimal(total)


async def check_daily_limit(purpose: Purpose) -> None:
    if purpose in CRITICAL_PURPOSES:
        # PO reading keeps working after the general limit, but has its own cap so a flood of
        # emails cannot spend without limit.
        if await spent_today_usd(CRITICAL_PURPOSES) >= Decimal(
            str(settings.llm_extraction_daily_cost_limit_usd)
        ):
            raise DailyCostLimitReached(
                "AI daily cost limit for PO reading reached; new POs wait until tomorrow"
            )
        return
    if await spent_today_usd() >= await daily_limit_usd():
        raise DailyCostLimitReached(
            f"AI daily cost limit reached; '{purpose}' calls are paused until tomorrow"
        )


async def record_call(
    purpose: str,
    model: str,
    order_id: uuid.UUID | None,
    tokens_in: int,
    tokens_out: int,
    stop_reason: str | None,
    cached_tokens_in: int = 0,
) -> Decimal:
    call_cost = cost_usd(model, tokens_in, tokens_out, cached_tokens_in)
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


async def call_ai(
    agent: Agent,
    purpose: Purpose,
    messages: list[dict],
    system: str | None = None,
    tools: list[dict] | None = None,
    response_schema: dict | None = None,
    order_id: uuid.UUID | None = None,
    max_tokens: int | None = None,
) -> AiResult:
    """Call the agent's model once. Raises DailyCostLimitReached, LlmRefused or LlmUnavailable."""
    await check_daily_limit(purpose)
    model = model_for(agent)
    if model not in prices():
        # A model without a price would count as free and slip past the daily cost limit.
        raise LlmUnavailable(f"No price for AI model '{model}'; add it to AI_PRICES", retryable=False)
    request: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens or settings.llm_max_tokens,
        "messages": to_provider_messages(messages, system),
    }
    if tools:
        request["tools"] = to_provider_tools(tools)
    if response_schema:
        request["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "result", "schema": response_schema},
        }

    reply = from_provider_reply(await post_chat_completion(request))
    tokens_in = int(reply.usage.get("prompt_tokens") or 0)
    tokens_out = int(reply.usage.get("completion_tokens") or 0)
    cached_tokens_in = int((reply.usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
    call_cost = await record_call(
        purpose, model, order_id, tokens_in, tokens_out, reply.stop_reason, cached_tokens_in
    )

    if reply.stop_reason == "content_filter":
        raise LlmRefused(f"The AI declined the {purpose} request")

    text = "".join(block.text for block in reply.content if block.type == "text")
    if response_schema and reply.stop_reason == "length":
        raise LlmTruncated(f"The {purpose} reply was cut off at {request['max_tokens']} tokens")
    data = parse_json_text(text) if response_schema and text else None
    return AiResult(reply, text, data, tokens_in, tokens_out, call_cost)
