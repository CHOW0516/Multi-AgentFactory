"""USD per million tokens per model, set in .env as AI_PRICES: [input, output, cached input].

Example: AI_PRICES={"grafilab/glm-5.3-flash": [0.08, 0.26, 0.02]}
The cached input price is optional; without it cached tokens cost the normal input price.
A model missing from AI_PRICES costs 0, so the daily cost limit only counts models with a price.
"""

import json
import logging
from decimal import Decimal
from functools import lru_cache

from app.core.config import settings

logger = logging.getLogger(__name__)

Prices = tuple[Decimal, Decimal, Decimal]  # input, output, cached input


@lru_cache
def prices() -> dict[str, Prices]:
    try:
        table = {}
        for model, values in json.loads(settings.ai_prices or "{}").items():
            input_price, output_price = Decimal(str(values[0])), Decimal(str(values[1]))
            cached_price = Decimal(str(values[2])) if len(values) > 2 else input_price
            table[model] = (input_price, output_price, cached_price)
        return table
    except (ValueError, TypeError, IndexError, KeyError, AttributeError):
        logger.warning(
            'AI_PRICES is not valid JSON like {"model": [input, output, cached]}; costs count as 0'
        )
        return {}


def cost_usd(model: str, tokens_in: int, tokens_out: int, cached_tokens_in: int = 0) -> Decimal:
    """tokens_in includes cached_tokens_in, as the provider reports it."""
    input_price, output_price, cached_price = prices().get(model, (Decimal(0), Decimal(0), Decimal(0)))
    uncached = max(tokens_in - cached_tokens_in, 0)
    total = uncached * input_price + cached_tokens_in * cached_price + tokens_out * output_price
    return Decimal(total) / Decimal(1_000_000)
