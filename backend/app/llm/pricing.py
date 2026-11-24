"""USD per million tokens (input, output). Update when prices change."""

from decimal import Decimal

PRICE_PER_MILLION_TOKENS: dict[str, tuple[Decimal, Decimal]] = {
    "claude-opus-5-5": (Decimal("4.00"), Decimal("20.00")),
    "claude-sonnet-5-5": (Decimal("2.00"), Decimal("10.00")),
    "claude-haiku-5-5": (Decimal("0.10"), Decimal("0.50")),
}
UNKNOWN_MODEL_PRICE = (Decimal("4.00"), Decimal("20.00"))  # assume the most expensive known tier


def cost_usd(model: str, tokens_in: int, tokens_out: int) -> Decimal:
    input_price, output_price = PRICE_PER_MILLION_TOKENS.get(model, UNKNOWN_MODEL_PRICE)
    return (Decimal(tokens_in) * input_price + Decimal(tokens_out) * output_price) / Decimal(1_000_000)
