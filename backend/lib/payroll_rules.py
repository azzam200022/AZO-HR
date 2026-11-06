"""Turns lateness, time away from the site, and manual adjustments into payroll figures.

Everything is computed over the employee's OWN cycle (hire-date anchored), never the
calendar month — so a new cycle's lateness can never be charged to a settled one.
"""

from lib.adjustments import adjustment_totals
from lib.cycle import pay_cycle
from lib.dates import now_time, today_iso
from lib.db import db
from lib.shift import (
    effective_away_minutes,
    employee_shift,
    is_working_day,
    late_minutes,
    shift_minutes,
)

#: payroll month is treated as 30 paid days
PAID_DAYS_PER_MONTH = 30


def minute_rate(base_salary: float, shift_start: str, shift_end: str) -> float:
    """Value of one working minute for this employee."""
    per_day = base_salary / PAID_DAYS_PER_MONTH
    minutes = shift_minutes(shift_start, shift_end) or 480
    return per_day / minutes


async def cycle_attendance(employee_id: str, start: str, end: str) -> list[dict]:
    """Attendance of one cycle; archived cycles are read back from the archive."""
    live = await db.attendance.find(
        {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}}
    ).to_list(500)
    if live:
        return live
    return await db.attendance_archive.find(
        {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}}
    ).to_list(500)


async def late_summary(employee: dict, on: str | None = None) -> tuple[int, int, float]:
    """(late_minutes, away_minutes, deduction) over the cycle containing `on`."""
    shift_start, shift_end, grace = employee_shift(employee)
    start, end = pay_cycle(employee, on)
    docs = await cycle_attendance(employee["id"], start, end)

    work_days = employee.get("work_days")
    total_late = sum(
        late_minutes(
            d.get("check_in", ""),
            shift_start,
            grace,
            work_date=d.get("date"),
            work_days=work_days,
        )
        for d in docs
    )
    now = now_time()
    today = today_iso()
    total_away = sum(
        effective_away_minutes(d, now, today, shift_start, shift_end)
        for d in docs
        if is_working_day(d.get("date", ""), work_days)
    )
    billable = total_late + total_away
    deduction = round(
        minute_rate(float(employee.get("base_salary", 0)), shift_start, shift_end) * billable, 2
    )
    return total_late, total_away, deduction


async def cycle_figures(employee: dict, on: str | None = None) -> dict:
    """Everything the payroll item needs for the cycle containing `on`."""
    start, end = pay_cycle(employee, on)
    late, away, late_deduction = await late_summary(employee, on)
    bonus, manual_deduction = await adjustment_totals(employee, start, end)
    return {
        "cycle_start": start,
        "cycle_end": end,
        "late_minutes": late,
        "away_minutes": away,
        "late_deduction": late_deduction,
        "bonus_total": bonus,
        "adjustment_deductions": manual_deduction,
    }


def net_of(item: dict) -> float:
    """Single source of truth for the net formula."""
    return max(
        0.0,
        float(item.get("base_salary", 0))
        + float(item.get("allowances", 0))
        + float(item.get("bonus_total", 0))
        - float(item.get("deductions", 0))
        - float(item.get("adjustment_deductions", 0))
        - float(item.get("late_deduction", 0)),
    )


async def settle_cycle(item: dict) -> int:
    """Close a paid cycle: archive its attendance and lock its adjustments.

    Archiving (not deleting) keeps the payslip auditable while clearing the running record,
    so the next cycle starts from zero.
    """
    employee_id = item["employee_id"]
    start, end = item.get("cycle_start", ""), item.get("cycle_end", "")
    if not start or not end:
        return 0

    docs = await db.attendance.find(
        {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}}
    ).to_list(500)
    if docs:
        for doc in docs:
            doc["payroll_id"] = item["id"]
            doc["archived_cycle"] = f"{start}..{end}"
        await db.attendance_archive.insert_many(docs)
        await db.attendance.delete_many(
            {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}}
        )

    await db.adjustments.update_many(
        {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}},
        {"$set": {"settled": True}},
    )
    return len(docs)
