"""Turns lateness, time away from the site, and manual adjustments into payroll figures.

Everything is computed over the employee's OWN cycle (hire-date anchored), never the
calendar month — so a new cycle's lateness can never be charged to a settled one.
"""

from lib.attendance_calendar import daily_attendance_records
from lib.cycle import pay_cycle
from lib.dates import now_time, today_iso
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


def absence_days_for_cycle(
    employee: dict,
    start: str,
    end: str,
    attendance_docs: list[dict],
    leave_docs: list[dict],
    *,
    today: str,
    now: str,
) -> int:
    """Count completed, scheduled workdays with no punch or approved leave."""
    records = daily_attendance_records(
        employee,
        start,
        end,
        attendance_docs,
        leave_docs,
        today=today,
        now=now,
    )
    return sum(record.status == "absent" for record in records)


def absence_deduction(base_salary: float, absent_days: int) -> float:
    """Deduct one thirtieth of the base salary for each absent workday."""
    return round((float(base_salary) / PAID_DAYS_PER_MONTH) * absent_days, 2)


async def cycle_attendance(employee_id: str, start: str, end: str) -> list[dict]:
    """Attendance of one cycle; archived cycles are read back from the archive."""
    from lib.db import db

    live = await db.attendance.find(
        {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}}
    ).to_list(500)
    if live:
        return live
    return await db.attendance_archive.find(
        {"employee_id": employee_id, "date": {"$gte": start, "$lte": end}}
    ).to_list(500)


async def late_summary(
    employee: dict,
    on: str | None = None,
    *,
    attendance_docs: list[dict] | None = None,
    today: str | None = None,
    now: str | None = None,
) -> tuple[int, int, float]:
    """(late_minutes, away_minutes, deduction) over the cycle containing `on`."""
    shift_start, shift_end, grace = employee_shift(employee)
    start, end = pay_cycle(employee, on)
    docs = (
        attendance_docs
        if attendance_docs is not None
        else await cycle_attendance(employee["id"], start, end)
    )

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
    now = now or now_time()
    today = today or today_iso()
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


async def absence_summary(
    employee: dict,
    on: str | None = None,
    *,
    attendance_docs: list[dict] | None = None,
    today: str | None = None,
    now: str | None = None,
) -> tuple[int, float]:
    """(absent_workdays, deduction) for the employee's cycle containing `on`."""
    from lib.db import db

    start, end = pay_cycle(employee, on)
    docs = (
        attendance_docs
        if attendance_docs is not None
        else await cycle_attendance(employee["id"], start, end)
    )
    leave_docs = await db.leaves.find(
        {
            "employee_id": employee["id"],
            "status": "approved",
            "start_date": {"$lte": end},
            "end_date": {"$gte": start},
        }
    ).to_list(500)
    absent_days = absence_days_for_cycle(
        employee,
        start,
        end,
        docs,
        leave_docs,
        today=today or today_iso(),
        now=now or now_time(),
    )
    return absent_days, absence_deduction(
        float(employee.get("base_salary", 0)),
        absent_days,
    )


async def cycle_figures(employee: dict, on: str | None = None) -> dict:
    """Everything the payroll item needs for the cycle containing `on`."""
    from lib.adjustments import adjustment_totals

    start, end = pay_cycle(employee, on)
    docs = await cycle_attendance(employee["id"], start, end)
    today, now = today_iso(), now_time()
    late, away, late_deduction = await late_summary(
        employee,
        on,
        attendance_docs=docs,
        today=today,
        now=now,
    )
    absent_days, absence_amount = await absence_summary(
        employee,
        on,
        attendance_docs=docs,
        today=today,
        now=now,
    )
    bonus, manual_deduction = await adjustment_totals(employee, start, end)
    return {
        "cycle_start": start,
        "cycle_end": end,
        "late_minutes": late,
        "away_minutes": away,
        "late_deduction": late_deduction,
        "absence_days": absent_days,
        "absence_deduction": absence_amount,
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
        - float(item.get("late_deduction", 0))
        - float(item.get("absence_deduction", 0)),
    )


async def settle_cycle(item: dict) -> int:
    """Close a paid cycle: archive its attendance and lock its adjustments.

    Archiving (not deleting) keeps the payslip auditable while clearing the running record,
    so the next cycle starts from zero.
    """
    from lib.db import db

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
