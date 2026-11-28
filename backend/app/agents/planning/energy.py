"""Electricity cost of planned machine time, using the peak and off-peak tariff set in Settings."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from app.agents.planning.calendar import DAY, Window, merge, utc
from app.models import Machine

HOUR = Decimal(3600)
CENT = Decimal("0.01")


@dataclass(frozen=True)
class EnergyUse:
    kwh: Decimal
    peak_kwh: Decimal
    cost: Decimal


@dataclass(frozen=True)
class Tariff:
    zone: ZoneInfo
    holidays: frozenset[date]
    enabled: bool
    peak_start_minute: int
    peak_end_minute: int
    peak_weekends: bool
    peak_holidays: bool
    peak_rate: Decimal
    offpeak_rate: Decimal
    heavy_machine_kw: Decimal

    @classmethod
    def from_config(cls, config: dict[str, float], zone: ZoneInfo, holidays: Iterable[date]) -> "Tariff":
        return cls(
            zone=zone,
            holidays=frozenset(holidays),
            enabled=config.get("energy_enabled", 0) >= 1,
            peak_start_minute=int(config.get("energy_peak_start_minute", 0)),
            peak_end_minute=int(config.get("energy_peak_end_minute", 0)),
            peak_weekends=config.get("energy_peak_weekends", 0) >= 1,
            peak_holidays=config.get("energy_peak_holidays", 0) >= 1,
            peak_rate=Decimal(str(config.get("energy_peak_rate", 0))),
            offpeak_rate=Decimal(str(config.get("energy_offpeak_rate", 0))),
            heavy_machine_kw=Decimal(str(config.get("energy_heavy_machine_kw", 0))),
        )

    @property
    def peak_saves_money(self) -> bool:
        """Moving work out of peak only helps when peak exists and costs more."""
        return (
            self.enabled
            and self.peak_start_minute != self.peak_end_minute
            and self.peak_rate > self.offpeak_rate
        )

    def is_peak_day(self, day: date) -> bool:
        if day in self.holidays and not self.peak_holidays:
            return False
        return day.weekday() < 5 or self.peak_weekends

    def peak_windows(self, start: datetime, end: datetime) -> list[Window]:
        """Peak periods between start and end, in UTC. A peak that crosses midnight belongs to the
        day it starts on, so Friday 22:00 to Saturday 06:00 is peak when Friday is a peak day."""
        if self.peak_start_minute == self.peak_end_minute:
            return []
        windows = []
        day = start.astimezone(self.zone).date() - DAY
        last = end.astimezone(self.zone).date()
        start_clock = time(self.peak_start_minute // 60, self.peak_start_minute % 60)
        end_clock = time(self.peak_end_minute // 60, self.peak_end_minute % 60)
        while day <= last:
            if self.is_peak_day(day):
                finish_day = day + DAY if self.peak_end_minute < self.peak_start_minute else day
                left, right = utc(day, start_clock, self.zone), utc(finish_day, end_clock, self.zone)
                if left < end and right > start:
                    windows.append((max(left, start), min(right, end)))
            day += DAY
        return merge(windows)

    def peak_seconds(self, start: datetime, end: datetime) -> int:
        return sum(int((right - left).total_seconds()) for left, right in self.peak_windows(start, end))

    def heavy(self, machine: Machine) -> bool:
        return machine.running_kw is not None and machine.running_kw >= self.heavy_machine_kw


def energy_use(
    tariff: Tariff, machines: dict[UUID, Machine], slots: Iterable[tuple[UUID, datetime, datetime]]
) -> EnergyUse | None:
    """kWh and cost of running these (machine id, start, end) slots. None when energy is off or no
    slot is on a machine with a kW value, so the app can show "not tracked" instead of zero."""
    if not tariff.enabled:
        return None
    kwh, peak_kwh, tracked = Decimal(0), Decimal(0), False
    for machine_id, start, end in slots:
        machine = machines.get(machine_id)
        if machine is None or machine.running_kw is None or end <= start:
            continue
        tracked = True
        seconds = Decimal(int((end - start).total_seconds()))
        peak = Decimal(tariff.peak_seconds(start, end))
        kwh += machine.running_kw * seconds / HOUR
        peak_kwh += machine.running_kw * peak / HOUR
    if not tracked:
        return None
    cost = peak_kwh * tariff.peak_rate + (kwh - peak_kwh) * tariff.offpeak_rate
    return EnergyUse(kwh.quantize(CENT), peak_kwh.quantize(CENT), cost.quantize(CENT))


def heavy_peak_blocks(tariff: Tariff, machines: list[Machine], start: datetime, end: datetime) -> dict:
    """Peak windows for each heavy machine, used as extra blocked time for the cheaper-energy plan."""
    windows = tariff.peak_windows(start, end)
    return {machine.id: windows for machine in machines if tariff.heavy(machine)} if windows else {}


def placements_in_peak(tariff: Tariff, machines: list[Machine], slots) -> bool:
    heavy_ids = {machine.id for machine in machines if tariff.heavy(machine)}
    return any(
        slot.machine_id in heavy_ids and tariff.peak_seconds(slot.start, slot.end) > 0 for slot in slots
    )
