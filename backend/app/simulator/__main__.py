"""Simulator commands.

python -m app.simulator seed [--reset] [--scenarios]   create demo data (+ test scenarios)
python -m app.simulator scenarios        add test scenarios to an already seeded database
python -m app.simulator test-pos --out DIR  write test PO PDFs + README.md (after the scenarios seed)
python -m app.simulator reset            wipe and re-seed (demo mode only)
python -m app.simulator run              simulator runtime: demo POs by email + machine events (demo mode only)
python -m app.simulator send-po          send one demo PO now (demo mode only)
"""

import argparse
import asyncio
import logging
import random
import sys
from pathlib import Path

from app.core.config import settings
from app.core.logging import setup_logging
from app.simulator.runtime import run_forever, send_one_purchase_order
from app.simulator.scenarios import add_scenarios
from app.simulator.seed import seed
from app.simulator.test_pos import write_test_files

logger = logging.getLogger("app.simulator")


async def seed_command(arguments) -> dict:
    """One event loop for both steps: the database engine is tied to the loop that first used it."""
    counts = await seed(reset=arguments.reset) if arguments.command == "seed" else {}
    if arguments.command == "scenarios" or arguments.scenarios:
        counts["test_scenarios"] = await add_scenarios()
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.simulator")
    parser.add_argument(
        "command",
        nargs="?",
        default="run",
        choices=["seed", "scenarios", "test-pos", "reset", "run", "send-po"],
    )
    parser.add_argument("--reset", action="store_true", help="wipe every table before seeding")
    parser.add_argument(
        "--scenarios", action="store_true", help="also add test orders in every state (see TEST_SCENARIOS.md)"
    )
    parser.add_argument("--out", default="test-pos", help="folder for test-pos (default: ./test-pos)")
    arguments = parser.parse_args()
    setup_logging()

    if arguments.command in ("reset", "run", "send-po") and not settings.is_demo:
        logger.error("'%s' only works when APP_MODE=demo", arguments.command)
        return 1
    if arguments.command in ("seed", "scenarios"):
        try:
            print(asyncio.run(seed_command(arguments)))
        except RuntimeError as error:
            logger.error("%s", error)
            return 1
        return 0
    if arguments.command == "test-pos":
        try:
            names = asyncio.run(write_test_files(Path(arguments.out)))
        except RuntimeError as error:
            logger.error("%s", error)
            return 1
        print(f"Wrote {len(names)} test POs and README.md to {arguments.out}")
        return 0
    if arguments.command == "reset":
        print(asyncio.run(seed(reset=True)))
        return 0
    if arguments.command == "send-po":
        order = asyncio.run(send_one_purchase_order(random.Random()))
        print(order.po_number if order else "No parts to order; run the seed first")
        return 0
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
