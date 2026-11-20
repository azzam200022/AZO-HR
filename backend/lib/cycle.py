"""Pay cycles anchored to each employee's own start date.

A payroll/attendance "month" is NOT the calendar month: it runs from the employee's cycle
anchor day (their custom `payroll_cycle_start`, else their hire date) to the day before the
same day next month. This is what makes a new month's lateness land on the new cycle and
never on the one already settled.
"""

from datetime import date, timedelta
from typing import Literal

from lib.dates import today_iso
from lib.leave_cycle import cycle_bounds

CyclePeriod = Literal["current", "previous"]


def cycle_anchor(employee: dict) -> str:
    """The date the employee's cycles count from."""
    return (employee.get("payroll_cycle_start") or "").strip() or employee["hire_date"]


def pay_cycle(employee: dict, on: str | None = None) -> tuple[str, str]:
    """(start_iso, end_iso) of the cycle containing `on` — today when omitted."""
    anchor = cycle_anchor(employee)
    if employee.get("payroll_cycle_start"):
        # This field selects a recurring day of the month, not the first date on
        # which cycles may exist. Keep the anchor day while avoiding the
        # "before hire date" special case when the configured date is in the
        # future (for example, a Dec 1 anchor while reporting November).
        anchor_day = date.fromisoformat(anchor).day
        anchor = f"2000-01-{anchor_day:02d}"
    return cycle_bounds(anchor, on)


def report_cycle_bounds(
    employee: dict,
    period: CyclePeriod,
    on: str | None = None,
) -> tuple[str, str]:
    """Return the employee's current or immediately preceding pay cycle."""
    reference = on or today_iso()
    if period == "current":
        return pay_cycle(employee, reference)
    if period == "previous":
        current_start, _ = pay_cycle(employee, reference)
        previous_reference = date.fromisoformat(current_start) - timedelta(days=1)
        return pay_cycle(employee, previous_reference.isoformat())
    raise ValueError(f"Unsupported cycle period: {period}")


def cycle_label(start: str) -> str:
    """Payroll items are keyed by the YYYY-MM the cycle starts in."""
    return start[:7]


def date_range_query(start: str, end: str) -> dict:
    return {"date": {"$gte": start, "$lte": end}}
