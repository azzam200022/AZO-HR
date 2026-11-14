from lib.cycle import report_cycle_bounds


def test_current_and_previous_pay_cycles_use_employee_cycle_anchor():
    employee = {"hire_date": "2024-05-15", "payroll_cycle_start": "2024-09-20"}

    assert report_cycle_bounds(employee, "current", "2026-11-14") == (
        "2026-10-20",
        "2026-11-19",
    )
    assert report_cycle_bounds(employee, "previous", "2026-11-14") == (
        "2026-09-20",
        "2026-10-19",
    )


def test_previous_pay_cycle_handles_end_of_month_anchor():
    employee = {"hire_date": "2024-01-31"}

    assert report_cycle_bounds(employee, "current", "2024-03-15") == (
        "2024-02-29",
        "2024-03-30",
    )
    assert report_cycle_bounds(employee, "previous", "2024-03-15") == (
        "2024-01-31",
        "2024-02-28",
    )


def test_previous_pay_cycle_does_not_go_before_hire_date():
    employee = {"hire_date": "2026-11-10"}

    current = report_cycle_bounds(employee, "current", "2026-11-14")
    previous = report_cycle_bounds(employee, "previous", "2026-11-14")

    assert previous == current
