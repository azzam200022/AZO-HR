"""Read-time daily attendance statuses derived from punches, shifts, and approved leave.

Synthetic absence/holiday rows are never persisted as punches and do not add payroll deductions.
"""

from datetime import date as date_type, datetime, time as time_type, timedelta

from lib.dates import aware, now_utc
from lib.shift import (
    effective_away_minutes,
    employee_shift,
    is_working_day,
    late_minutes,
    to_minutes,
)
from models.hr import AttendanceRecord


def _shift_ended_on_date(work_date: str, today: str, now: str, start: str, end: str) -> bool:
    """Use the shift's work date, including overnight end dates, to decide absence."""
    try:
        work_day = date_type.fromisoformat(work_date)
        current_day = date_type.fromisoformat(today)
        hour, minute = (int(part) for part in now.split(":"))
    except (TypeError, ValueError):
        return False
    end_day = work_day + timedelta(days=1) if to_minutes(end) <= to_minutes(start) else work_day
    if end_day < current_day:
        return True
    if end_day > current_day:
        return False
    end_minutes = to_minutes(end)
    return datetime.combine(current_day, time_type(hour, minute)) >= datetime.combine(
        end_day, time_type(end_minutes // 60, end_minutes % 60)
    )


def _actual_record(doc: dict, employee: dict, today: str, now: str) -> AttendanceRecord:
    """Normalize an existing punch and derive its current schedule-based totals."""
    record = dict(doc)
    record["status"] = record.get("status") or "present"
    record["is_synthetic"] = False
    created_at = record.get("created_at")
    if created_at is None:
        record.pop("created_at", None)
    else:
        record["created_at"] = aware(created_at)
    record["check_in_at"] = aware(record.get("check_in_at"))
    start, end, grace = employee_shift(employee)
    work_days = employee.get("work_days")
    record["late_minutes"] = late_minutes(
        record.get("check_in", ""), start, grace,
        work_date=record.get("date"), work_days=work_days,
    )
    if not is_working_day(record.get("date", ""), work_days):
        record["away_minutes"] = 0
    else:
        record["away_minutes"] = effective_away_minutes(record, now, today, start, end)
    return AttendanceRecord(**record)


def daily_attendance_records(
    employee: dict,
    start_date: str,
    end_date: str,
    attendance_docs: list[dict],
    leave_docs: list[dict],
    *,
    today: str,
    now: str,
) -> list[AttendanceRecord]:
    """Return real punches plus synthesized present/absent/leave/holiday day rows."""
    try:
        start_day = date_type.fromisoformat(start_date)
        end_day = min(date_type.fromisoformat(end_date), date_type.fromisoformat(today))
        hire_day = date_type.fromisoformat(employee.get("hire_date") or start_date)
    except (TypeError, ValueError):
        return []
    start_day = max(start_day, hire_day)
    if end_day < start_day:
        return []

    rows: dict[str, AttendanceRecord] = {}
    for doc in attendance_docs:
        day = doc.get("date") or ""
        if start_date <= day <= end_date and start_day.isoformat() <= day <= end_day.isoformat():
            rows[day] = _actual_record(doc, employee, today, now)

    # Inactive employees keep their real history, but we cannot infer their termination date.
    if employee.get("status", "active") == "active":
        approved_leaves = [leave for leave in leave_docs if leave.get("status") == "approved"]
        shift_start, shift_end, _grace = employee_shift(employee)
        day = start_day
        while day <= end_day:
            day_iso = day.isoformat()
            if day_iso not in rows:
                if not is_working_day(day_iso, employee.get("work_days")):
                    status = "holiday"
                elif any(
                    (leave.get("start_date", "") <= day_iso <= leave.get("end_date", ""))
                    for leave in approved_leaves
                ):
                    status = "leave"
                elif _shift_ended_on_date(day_iso, today, now, shift_start, shift_end):
                    status = "absent"
                else:
                    status = ""
                if status:
                    rows[day_iso] = AttendanceRecord(
                        id=f"calendar-{employee.get('id', 'employee')}-{day_iso}",
                        employee_id=employee["id"],
                        date=day_iso,
                        status=status,
                        is_synthetic=True,
                        created_at=now_utc(),
                    )
            day += timedelta(days=1)
    return sorted(rows.values(), key=lambda row: (row.date, row.check_in), reverse=True)
