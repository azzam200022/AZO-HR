"""Pay cycles anchored to each employee's own start date.

A payroll/attendance "month" is NOT the calendar month: it runs from the employee's cycle
anchor day (their custom `payroll_cycle_start`, else their hire date) to the day before the
same day next month. This is what makes a new month's lateness land on the new cycle and
never on the one already settled.
"""

from lib.leave_cycle import cycle_bounds


def cycle_anchor(employee: dict) -> str:
    """The date the employee's cycles count from."""
    return (employee.get("payroll_cycle_start") or "").strip() or employee["hire_date"]


def pay_cycle(employee: dict, on: str | None = None) -> tuple[str, str]:
    """(start_iso, end_iso) of the cycle containing `on` — today when omitted."""
    return cycle_bounds(cycle_anchor(employee), on)


def cycle_label(start: str) -> str:
    """Payroll items are keyed by the YYYY-MM the cycle starts in."""
    return start[:7]


def date_range_query(start: str, end: str) -> dict:
    return {"date": {"$gte": start, "$lte": end}}
