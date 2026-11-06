from datetime import datetime, timezone

from lib.attendance_calendar import daily_attendance_records
from lib.shift import effective_away_minutes


def staff(**updates):
    return {
        "id": "employee-1",
        "status": "active",
        "hire_date": "2026-01-01",
        "shift_start": "09:00",
        "shift_end": "17:00",
        "work_days": [0, 1, 2, 3, 4],
        **updates,
    }


def records(date, *, employee=None, punches=None, leaves=None, today="2026-11-05", now="17:01"):
    return daily_attendance_records(
        employee or staff(),
        date,
        date,
        punches or [],
        leaves or [],
        today=today,
        now=now,
    )


def test_missing_scheduled_day_becomes_absent_after_shift_end():
    result = records("2026-11-05")
    assert len(result) == 1
    assert result[0].status == "absent"
    assert result[0].is_synthetic is True
    assert result[0].check_in == ""


def test_current_workday_is_not_absent_before_shift_end():
    assert records("2026-11-05", now="16:59") == []


def test_weekly_rest_day_is_recorded_as_holiday():
    result = records("2026-11-07", now="12:00")
    assert len(result) == 1
    assert result[0].status == "holiday"


def test_approved_leave_replaces_absence_but_pending_leave_does_not():
    approved = [{"start_date": "2026-11-05", "end_date": "2026-11-05", "status": "approved"}]
    pending = [{"start_date": "2026-11-05", "end_date": "2026-11-05", "status": "pending"}]
    assert records("2026-11-05", leaves=approved)[0].status == "leave"
    assert records("2026-11-05", leaves=pending)[0].status == "absent"


def test_real_punch_overrides_synthetic_leave_status():
    punch = {
        "id": "attendance-1",
        "employee_id": "employee-1",
        "date": "2026-11-05",
        "check_in": "09:00",
        "check_out": "17:00",
        "created_at": datetime(2026, 11, 5, 6, tzinfo=timezone.utc),
    }
    result = records(
        "2026-11-05",
        punches=[punch],
        leaves=[{"start_date": "2026-11-05", "end_date": "2026-11-05", "status": "approved"}],
    )
    assert len(result) == 1
    assert result[0].status == "present"
    assert result[0].is_synthetic is False


def test_overnight_shift_is_not_marked_absent_before_its_start_or_end():
    night_staff = staff(shift_start="22:00", shift_end="06:00")
    assert records(
        "2026-11-05", employee=night_staff, today="2026-11-05", now="21:59"
    ) == []
    assert records(
        "2026-11-05", employee=night_staff, today="2026-11-06", now="01:00"
    ) == []


def test_overnight_shift_becomes_absent_only_after_next_morning_end():
    night_staff = staff(shift_start="22:00", shift_end="06:00")
    result = records(
        "2026-11-05", employee=night_staff, today="2026-11-06", now="06:01"
    )
    assert len(result) == 1
    assert result[0].status == "absent"


def test_hire_date_limits_synthetic_records():
    new_hire = staff(hire_date="2026-11-06")
    assert records("2026-11-05", employee=new_hire) == []


def test_open_departure_counts_until_shift_end_for_payroll():
    punch = {"date": "2026-11-05", "outside_since": "15:55", "away_minutes": 0}
    assert effective_away_minutes(punch, "17:05", "2026-11-05", "08:00", "16:00") == 5


def test_open_departure_counts_live_minutes_during_shift():
    punch = {"date": "2026-11-05", "outside_since": "15:55", "away_minutes": 0}
    assert effective_away_minutes(punch, "15:58", "2026-11-05", "08:00", "16:00") == 3


def test_open_overnight_departure_counts_only_until_current_time():
    punch = {"date": "2026-11-05", "outside_since": "23:30", "away_minutes": 0}
    assert effective_away_minutes(punch, "01:00", "2026-11-06", "22:00", "06:00") == 90


def test_open_overnight_departure_caps_at_end_after_shift_finishes():
    punch = {"date": "2026-11-05", "outside_since": "23:30", "away_minutes": 0}
    assert effective_away_minutes(punch, "06:30", "2026-11-06", "22:00", "06:00") == 390
