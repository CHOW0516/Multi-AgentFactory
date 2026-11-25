"""Simulator commands.

python -m app.simulator seed [--reset]   create demo data
python -m app.simulator reset            wipe and re-seed (demo mode only)
python -m app.simulator run              simulator runtime: demo POs by email + machine events (demo mode only)
python -m app.simulator send-po          send one demo PO now (demo mode only)
"""

import argparse
import asyncio
import logging
import random
import sys

from app.core.config import settings
from app.core.logging import setup_logging
from app.simulator.runtime import run_forever, send_one_purchase_order
from app.simulator.seed import seed

logger = logging.getLogger("app.simulator")


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.simulator")
    parser.add_argument("command", nargs="?", default="run", choices=["seed", "reset", "run", "send-po"])
    parser.add_argument("--reset", action="store_true", help="wipe every table before seeding")
    arguments = parser.parse_args()
    setup_logging()

    if arguments.command in ("reset", "run", "send-po") and not settings.is_demo:
        logger.error("'%s' only works when APP_MODE=demo", arguments.command)
        return 1
    if arguments.command == "seed":
        try:
            print(asyncio.run(seed(reset=arguments.reset)))
        except RuntimeError as error:
            logger.error("%s", error)
            return 1
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
