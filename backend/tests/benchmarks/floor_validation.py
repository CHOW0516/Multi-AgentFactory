"""CPU-only layout benchmark; no database, credentials or application data."""

import time
import uuid

from app.floor import validate_layout
from app.schemas.floor import LayoutIn, LayoutMachine


def main():
    for count, repeats in [(20, 2000), (200, 1000), (1000, 100)]:
        body = LayoutIn(
            revision=0,
            origin_x=0,
            origin_y=0,
            columns=1000,
            rows=1000,
            machines=[
                LayoutMachine(
                    id=uuid.uuid4(),
                    code=f"M{i}",
                    name=f"Machine {i}",
                    machine_type="cnc_mill",
                    x=i % 50 * 14,
                    y=i // 50 * 11,
                )
                for i in range(count)
            ],
            decor=[],
        )
        started = time.perf_counter()
        for _ in range(repeats):
            assert validate_layout(body) == []
        print(f"{count} machines: {(time.perf_counter() - started) * 1000 / repeats:.3f} ms/save validation")


if __name__ == "__main__":
    main()
