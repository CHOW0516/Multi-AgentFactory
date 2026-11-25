"""Convert local shifts and machine exclusions to UTC working intervals."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models import Shift

type Window = tuple[datetime, datetime]
DAY = timedelta(days=1)


def utc(day: date, clock: time, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, clock, tzinfo=zone).astimezone(UTC)


def merge(windows: list[Window]) -> list[Window]:
    merged: list[Window] = []
    for start, end in sorted(windows):
        if start >= end:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = merged[-1][0], max(end, merged[-1][1])
        else:
            merged.append((start, end))
    return merged


def cut(windows: list[Window], exclusions: list[Window]) -> list[Window]:
    remaining = []
    blocked = merge(exclusions)
    for start, end in windows:
        for left, right in blocked:
            if right <= start:
                continue
            if left >= end:
                break
            if left > start:
                remaining.append((start, left))
            start = max(start, right)
            if start >= end:
                break
        if start < end:
            remaining.append((start, end))
    return remaining


def calendar(
    start: datetime,
    end: datetime,
    zone: ZoneInfo,
    shifts: list[Shift],
    holidays: set[date],
) -> tuple[list[Window], list[Window]]:
    """Return regular and out-of-shift intervals with holidays removed from both."""
    regular, days, holiday_windows = [], [], []
    day = start.astimezone(zone).date() - DAY
    last = end.astimezone(zone).date()
    while day <= last:
        next_day = day + DAY
        bounds = max(start, utc(day, time.min, zone)), min(end, utc(next_day, time.min, zone))
        if day in holidays:
            holiday_windows.append(bounds)
        else:
            days.append(bounds)
            for shift in shifts:
                if shift.weekday == day.weekday():
                    finish_day = next_day if shift.end_time <= shift.start_time else day
                    regular.append(
                        (
                            max(start, utc(day, shift.start_time, zone)),
                            min(end, utc(finish_day, shift.end_time, zone)),
                        )
                    )
        day = next_day
    regular = cut(merge(regular), holiday_windows)
    return regular, cut(merge(days), regular)


def overlaps(first: Window, second: Window) -> bool:
    return first[0] < second[1] and second[0] < first[1]
