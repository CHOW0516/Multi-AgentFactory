import asyncio
import logging

from app.core.logging import setup_logging

from . import scan


async def main():
    setup_logging()
    while True:
        try:
            await scan()
        except Exception:
            logging.exception("Could not scan maintenance events")
        await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
