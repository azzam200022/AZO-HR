"""Work-shift maths: per-employee shift windows, overnight shifts, and late minutes.

Late rule (as specified):
  • arriving at or before shift_start + grace  → no late at all
  • arriving after that grace instant          → late counted from SHIFT_START, not from
                                                 the end of the grace window
  e.g. shift 08:00 with 5 min grace → 08:05 = 0, 08:06 = 6 min, 08:30 = 30 min.
The same rule applies to an evening shift (16:00 → 00:00) using its own start time.
"""

from datetime import date, timedelta

DEFAULT_SHIFT_START = "08:00"
DEFAULT_SHIFT_END = "16:00"
DEFAULT_GRACE_MINUTES = 5


def to_minutes(hhmm: str) -> int:
    hours, minutes = (int(part) for part in hhmm.split(":"))
    return hours * 60 + minutes


def to_hhmm(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def is_overnight(shift_start: str, shift_end: str) -> bool:
    """16:00 → 00:00 ends on the next calendar day."""
    return to_minutes(shift_end) <= to_minutes(shift_start)


def shift_minutes(shift_start: str, shift_end: str) -> int:
    """Scheduled length of the shift in minutes."""
    start, end = to_minutes(shift_start), to_minutes(shift_end)
    if end <= start:
        end += 24 * 60
    return end - start


def is_working_day(work_date: str, work_days: list[int] | tuple[int, ...] | None = None) -> bool:
    """Whether an ISO date is scheduled; missing/invalid schedules preserve all-days behavior."""
    if not work_days:
        return True
    try:
        weekday = date.fromisoformat(work_date).weekday()
    except (TypeError, ValueError):
        return True
    return weekday in work_days


def late_minutes(
    check_in: str,
    shift_start: str,
    grace: int = DEFAULT_GRACE_MINUTES,
    *,
    work_date: str | None = None,
    work_days: list[int] | tuple[int, ...] | None = None,
) -> int:
    """Minutes of lateness for this punch, per the rule documented above.

    Uses the SAME signed offset as the shift-window checks, so a punch accepted as an early
    arrival can never be recorded as hours of lateness. An unscheduled day is not late.
    """
    if not check_in or (work_date and not is_working_day(work_date, work_days)):
        return 0
    offset = minutes_since_start(check_in, shift_start)
    if offset <= grace:
        return 0  # early or inside the grace window
    return offset


def worked_minutes(check_in: str, check_out: str) -> int:
    """Minutes between the punches, wrapping past midnight for night shifts."""
    if not check_in or not check_out:
        return 0
    start, end = to_minutes(check_in), to_minutes(check_out)
    if end < start:
        end += 24 * 60
    return end - start


def minutes_since_start(now: str, shift_start: str) -> int:
    """Signed minutes from the shift start to `now`, normalised to (-720, +720].

    Signed on purpose: arriving 30 minutes EARLY is -30, not +1410 — otherwise an early
    punch would look like a finished shift.
    """
    diff = to_minutes(now) - to_minutes(shift_start)
    while diff > 12 * 60:
        diff -= 24 * 60
    while diff <= -12 * 60:
        diff += 24 * 60
    return diff


def is_within_shift(now: str, shift_start: str, shift_end: str) -> bool:
    """True while `now` falls inside the scheduled window (night shifts included)."""
    elapsed = minutes_since_start(now, shift_start)
    return 0 <= elapsed <= shift_minutes(shift_start, shift_end)


#: how early before the shift start a punch is still accepted
EARLY_PUNCH_WINDOW_MINUTES = 120


def shift_has_ended(now: str, shift_start: str, shift_end: str) -> bool:
    """A punch is refused once the employee's own shift window is over for the day."""
    return minutes_since_start(now, shift_start) > shift_minutes(shift_start, shift_end)


def shift_not_started(now: str, shift_start: str) -> bool:
    """True well before the shift begins — stops a 23:59 punch counting as "early" for an
    08:00 shift, while still allowing a normal early arrival."""
    return minutes_since_start(now, shift_start) < -EARLY_PUNCH_WINDOW_MINUTES


def employee_shift(employee: dict) -> tuple[str, str, int]:
    """(shift_start, shift_end, grace_minutes) with defaults for older records."""
    return (
        employee.get("shift_start") or DEFAULT_SHIFT_START,
        employee.get("shift_end") or DEFAULT_SHIFT_END,
        int(employee.get("grace_minutes", DEFAULT_GRACE_MINUTES)),
    )

def away_minutes_at(
    record: dict, now: str, shift_start: str, shift_end: str
) -> int:
    """Saved away time plus the open interval through `now`, capped at the shift end."""
    total = int(record.get("away_minutes", 0))
    outside_since = record.get("outside_since") or ""
    if not outside_since:
        return total
    day_minutes = 24 * 60
    start = (to_minutes(outside_since) - to_minutes(shift_start)) % day_minutes
    end = (to_minutes(now) - to_minutes(shift_start)) % day_minutes
    scheduled = shift_minutes(shift_start, shift_end)
    start = min(start, scheduled)
    end = max(start, min(end, scheduled))
    return total + end - start


def effective_away_minutes(
    record: dict, now: str, today: str, shift_start: str, shift_end: str
) -> int:
    """Count an open departure to now during a shift, or to shift end after it."""
    outside_since = record.get("outside_since") or ""
    if not outside_since:
        return int(record.get("away_minutes", 0))
    record_date = record.get("date") or today
    try:
        is_previous_overnight_day = (
            to_minutes(shift_end) <= to_minutes(shift_start)
            and date.fromisoformat(record_date) + timedelta(days=1) == date.fromisoformat(today)
            and to_minutes(now) < to_minutes(shift_end)
        )
    except ValueError:
        is_previous_overnight_day = False
    if is_previous_overnight_day:
        interval_end = now
    elif record_date < today or shift_has_ended(now, shift_start, shift_end):
        interval_end = shift_end
    else:
        interval_end = now
    return away_minutes_at(record, interval_end, shift_start, shift_end)
