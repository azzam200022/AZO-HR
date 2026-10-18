"""Leave cycles anchored to the employee's hire date.

A "month" for leave-quota purposes is NOT the calendar month: it runs from the employee's
hire day-of-month to the day before the same day next month (e.g. hired on the 15th →
cycles are 15→14). The quota resets at each cycle boundary.
"""

from datetime import date, datetime

from lib.dates import today_iso


def _parse(iso: str) -> date:
    return datetime.strptime(iso, "%Y-%m-%d").date()


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = (year * 12 + (month - 1)) + delta
    return index // 12, index % 12 + 1


def _clamp_day(year: int, month: int, day: int) -> date:
    """Anchor day 31 onto shorter months (31 Jan → 28/29 Feb)."""
    for candidate in range(day, 27, -1):
        try:
            return date(year, month, candidate)
        except ValueError:
            continue
    return date(year, month, min(day, 28))


def cycle_bounds(hire_date: str, on: str | None = None) -> tuple[str, str]:
    """Return (start_iso, end_iso) of the leave cycle containing `on` (inclusive bounds)."""
    today = _parse(on or today_iso())
    hired = _parse(hire_date)
    if today < hired:
        # Before the start date, use the first cycle.
        start = hired
    else:
        anchor_day = hired.day
        start = _clamp_day(today.year, today.month, anchor_day)
        if start > today:
            year, month = _shift_month(today.year, today.month, -1)
            start = _clamp_day(year, month, anchor_day)
        if start < hired:
            start = hired

    year, month = _shift_month(start.year, start.month, 1)
    next_start = _clamp_day(year, month, hired.day)
    if next_start <= start:  # safety for clamped edges
        year, month = _shift_month(start.year, start.month, 2)
        next_start = _clamp_day(year, month, hired.day)
    end = date.fromordinal(next_start.toordinal() - 1)
    return start.isoformat(), end.isoformat()


def overlaps_cycle(leave: dict, start: str, end: str) -> bool:
    """A leave counts against the cycle it starts in."""
    return start <= leave.get("start_date", "") <= end