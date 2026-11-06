"""Report building shared by the employee portal (/me/report) and the manager console
(/employees/{id}/report) — one implementation, two audiences."""

from lib.attendance_calendar import daily_attendance_records
from lib.cycle import pay_cycle
from lib.dates import aware, current_month, now_time, today_iso
from lib.db import db
from lib.leave_cycle import cycle_bounds, overlaps_cycle
from lib.payroll_rules import cycle_attendance
from lib.shift import employee_shift, is_working_day, late_minutes, onsite_worked_minutes
from models.hr import (
    AttendanceRecord,
    Employee,
    EmployeeReport,
    LeaveBalance,
    LeaveRequest,
    MonthlyAttendanceReport,
)


def _minutes(check_in: str, check_out: str, away_minutes: int = 0) -> int:
    """Net on-site minutes, wrapping past midnight for night shifts."""
    return onsite_worked_minutes(check_in, check_out, away_minutes)


async def leave_balance(employee: dict) -> LeaveBalance:
    start, end = cycle_bounds(employee["hire_date"])
    quota = int(employee.get("monthly_leave_quota", 2))
    leaves = await db.leaves.find(
        {"employee_id": employee["id"], "status": {"$in": ["pending", "approved"]}}
    ).to_list(1000)
    used = sum(1 for leave in leaves if overlaps_cycle(leave, start, end))
    return LeaveBalance(
        cycle_start=start,
        cycle_end=end,
        quota=quota,
        used=used,
        remaining=max(0, quota - used),
    )


async def build_report(employee: dict, month: str | None = None) -> EmployeeReport:
    """Report for the employee's OWN cycle inside `month` (hire-date anchored, not calendar)."""
    month = month or current_month()
    reference = today_iso() if today_iso().startswith(month) else f"{month}-15"
    cycle_start, cycle_end = pay_cycle(employee, reference)

    shift_start, shift_end, grace = employee_shift(employee)

    # Settled cycles live in the archive; missing daily statuses are derived on read.
    docs = await cycle_attendance(employee["id"], cycle_start, cycle_end)
    leave_docs = (
        await db.leaves.find({"employee_id": employee["id"]}).sort("start_date", -1).to_list(500)
    )
    for d in leave_docs:
        d["created_at"] = aware(d.get("created_at"))

    today = today_iso()
    records = daily_attendance_records(
        employee,
        cycle_start,
        min(cycle_end, today),
        docs,
        leave_docs,
        today=today,
        now=now_time(),
    )
    present_records = [r for r in records if r.status == "present"]
    complete = [r for r in present_records if r.check_in and r.check_out]
    total_minutes = sum(
        _minutes(r.check_in, r.check_out, r.away_minutes) for r in present_records
    )
    scheduled_records = [
        r
        for r in present_records
        if is_working_day(r.date, employee.get("work_days"))
    ]
    late_records = [r for r in scheduled_records if r.late_minutes > 0]
    total_away = sum(r.away_minutes for r in present_records)
    check_ins = [r.check_in for r in present_records if r.check_in]
    avg_check_in = ""
    if check_ins:
        avg = sum(int(c[:2]) * 60 + int(c[3:5]) for c in check_ins) // len(check_ins)
        avg_check_in = f"{avg // 60:02d}:{avg % 60:02d}"

    employee_model = {**employee, "created_at": aware(employee.get("created_at"))}
    location_name = ""
    if employee.get("location_id"):
        loc = await db.locations.find_one({"id": employee["location_id"]})
        location_name = loc["name"] if loc else ""

    return EmployeeReport(
        employee=Employee(**employee_model),
        location_name=location_name,
        attendance=MonthlyAttendanceReport(
            month=month,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            days_present=len(present_records),
            days_complete=len(complete),
            total_minutes=total_minutes,
            avg_check_in=avg_check_in,
            late_days=len(late_records),
            total_late_minutes=sum(r.late_minutes for r in late_records) + total_away,
            total_away_minutes=total_away,
            on_time_days=len(scheduled_records) - len(late_records),
            shift_start=shift_start,
            shift_end=shift_end,
            grace_minutes=grace,
            records=records,
        ),
        leaves=[LeaveRequest(**d) for d in leave_docs],
        balance=await leave_balance(employee),
    )