"""USD per million tokens (input, output), set per model in .env as AI_PRICES.

Example: AI_PRICES={"gemini/gemini-3.8-flash": [0.30, 2.50], "grafilab/glm-5.3-flash": [0.10, 0.40]}
A model missing from AI_PRICES costs 0, so the daily cost limit only counts models with a price.
"""

import json
import logging
from decimal import Decimal
from functools import lru_cache

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache
def prices() -> dict[str, tuple[Decimal, Decimal]]:
    try:
        raw = json.loads(settings.ai_prices or "{}")
        return {model: (Decimal(str(pair[0])), Decimal(str(pair[1]))) for model, pair in raw.items()}
    except (ValueError, TypeError, IndexError, KeyError, AttributeError):
        logger.warning('AI_PRICES is not valid JSON like {"model": [input, output]}; costs are counted as 0')
        return {}


def cost_usd(model: str, tokens_in: int, tokens_out: int) -> Decimal:
    input_price, output_price = prices().get(model, (Decimal(0), Decimal(0)))
    return (Decimal(tokens_in) * input_price + Decimal(tokens_out) * output_price) / Decimal(1_000_000)
