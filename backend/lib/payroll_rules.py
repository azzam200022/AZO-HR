"""Turns lateness and time away from the work site into a payroll deduction.

The rate is derived from the employee's own salary and shift length, so the deduction is
proportional: a minute costs exactly what a minute of that employee's work is worth.
"""

from lib.dates import aware  # noqa: F401  (kept for symmetry with other lib modules)
from lib.db import db
from lib.shift import employee_shift, late_minutes, shift_minutes

#: payroll month is treated as 30 paid days
PAID_DAYS_PER_MONTH = 30


def minute_rate(base_salary: float, shift_start: str, shift_end: str) -> float:
    """Value of one working minute for this employee."""
    per_day = base_salary / PAID_DAYS_PER_MONTH
    minutes = shift_minutes(shift_start, shift_end) or 480
    return per_day / minutes


async def late_summary(employee: dict, month: str) -> tuple[int, int, float]:
    """(late_minutes, away_minutes, deduction) for the employee's attendance that month."""
    shift_start, shift_end, grace = employee_shift(employee)
    docs = await db.attendance.find(
        {"employee_id": employee["id"], "date": {"$regex": f"^{month}"}}
    ).to_list(500)

    total_late = sum(late_minutes(d.get("check_in", ""), shift_start, grace) for d in docs)
    total_away = sum(int(d.get("away_minutes", 0)) for d in docs)
    billable = total_late + total_away
    deduction = round(minute_rate(float(employee.get("base_salary", 0)), shift_start, shift_end) * billable, 2)
    return total_late, total_away, deduction


def net_of(item: dict) -> float:
    """Single source of truth for the net formula."""
    return max(
        0.0,
        float(item.get("base_salary", 0))
        + float(item.get("allowances", 0))
        - float(item.get("deductions", 0))
        - float(item.get("late_deduction", 0)),
    )
