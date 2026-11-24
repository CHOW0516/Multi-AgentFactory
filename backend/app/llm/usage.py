"""Collects LLM token usage while one message is being handled, so its result can report it."""

from contextvars import ContextVar
from dataclasses import dataclass
from decimal import Decimal


@dataclass
class UsageTotals:
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: Decimal = Decimal("0")


current_usage: ContextVar[UsageTotals | None] = ContextVar("current_usage", default=None)


def add_usage(tokens_in: int, tokens_out: int, cost_usd: Decimal) -> None:
    totals = current_usage.get()
    if totals is not None:
        totals.tokens_in += tokens_in
        totals.tokens_out += tokens_out
        totals.cost_usd += cost_usd
