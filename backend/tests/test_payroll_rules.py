from lib.payroll_rules import absence_days_for_cycle, absence_deduction, net_of


def staff(**updates):
    return {
        "id": "employee-1",
        "status": "active",
        "hire_date": "2026-01-01",
        "shift_start": "09:00",
        "shift_end": "17:00",
        "work_days": list(range(7)),
        "base_salary": 900_000,
        **updates,
    }


def test_absence_counts_only_missing_scheduled_days_without_approved_leave():
    attendance_docs = [
        {
            "id": "attendance-1",
            "employee_id": "employee-1",
            "date": "2026-11-08",
            "check_in": "09:00",
            "check_out": "17:00",
        }
    ]
    leave_docs = [
        {
            "employee_id": "employee-1",
            "start_date": "2026-11-07",
            "end_date": "2026-11-07",
            "status": "approved",
        }
    ]

    days = absence_days_for_cycle(
        staff(work_days=[0, 1, 2, 3, 5, 6]),
        "2026-11-05",
        "2026-11-08",
        attendance_docs,
        leave_docs,
        today="2026-11-08",
        now="18:00",
    )

    assert days == 1


def test_absence_is_not_counted_before_shift_end_or_on_a_rest_day():
    employee = staff(work_days=[0, 1, 2, 3, 5, 6])

    before_end = absence_days_for_cycle(
        employee,
        "2026-11-05",
        "2026-11-05",
        [],
        [],
        today="2026-11-05",
        now="16:59",
    )
    rest_day = absence_days_for_cycle(
        employee,
        "2026-11-06",
        "2026-11-06",
        [],
        [],
        today="2026-11-06",
        now="18:00",
    )

    assert before_end == 0
    assert rest_day == 0


def test_absence_deduction_is_one_thirtieth_of_base_salary_per_day():
    assert absence_deduction(900_000, 2) == 60_000


def test_net_includes_absence_deduction_and_never_goes_below_zero():
    assert net_of(
        {
            "base_salary": 900_000,
            "absence_deduction": 30_000,
        }
    ) == 870_000
    assert net_of({"absence_deduction": 30_000}) == 0
