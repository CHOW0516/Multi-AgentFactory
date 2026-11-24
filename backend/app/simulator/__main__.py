"""Simulator commands.

python -m app.simulator seed [--reset]   create demo data
python -m app.simulator reset            wipe and re-seed (demo mode only)
python -m app.simulator run              simulator runtime (demo mode only; added in stage B)
"""

import argparse
import asyncio
import logging
import sys

from app.core.config import settings
from app.core.logging import setup_logging
from app.simulator.seed import seed

logger = logging.getLogger("app.simulator")


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.simulator")
    parser.add_argument("command", nargs="?", default="run", choices=["seed", "reset", "run"])
    parser.add_argument("--reset", action="store_true", help="wipe every table before seeding")
    arguments = parser.parse_args()
    setup_logging()

    if arguments.command in ("reset", "run") and not settings.is_demo:
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
    logger.warning("The simulator runtime is not built yet (P1 stage B). Nothing to run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
