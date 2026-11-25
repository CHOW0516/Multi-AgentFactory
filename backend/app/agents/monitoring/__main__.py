import asyncio

from app.messaging import run_consumer

from . import handle

if __name__ == "__main__":
    asyncio.run(run_consumer("agent.monitoring", handle, ["event.machine.raw"], prefetch=1))
