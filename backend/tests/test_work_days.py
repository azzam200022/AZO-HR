import pytest
from pydantic import ValidationError

from lib.shift import is_working_day, late_minutes
from models.hr import Employee, EmployeeCreate, EmployeeUpdate


FRIDAY_OFF = [0, 1, 2, 3, 5, 6]


def test_friday_is_not_a_working_day_when_not_selected():
    assert not is_working_day("2026-11-06", FRIDAY_OFF)
    assert is_working_day("2026-11-05", FRIDAY_OFF)


def test_lateness_is_zero_on_a_scheduled_day_off():
    assert (
        late_minutes(
            "09:00",
            "08:00",
            5,
            work_date="2026-11-06",
            work_days=FRIDAY_OFF,
        )
        == 0
    )
    assert (
        late_minutes(
            "09:00",
            "08:00",
            5,
            work_date="2026-11-05",
            work_days=FRIDAY_OFF,
        )
        == 60
    )


def test_legacy_employees_default_to_all_seven_days():
    employee = Employee(name="Test", job_title="Test", hire_date="2026-11-01")
    assert employee.work_days == list(range(7))
    assert is_working_day("2026-11-06", employee.work_days)


def test_employee_work_days_are_validated_and_normalized():
    employee = EmployeeCreate(
        name="Test",
        job_title="Test",
        base_salary=1,
        hire_date="2026-11-01",
        work_days=[4, 0],
    )
    assert employee.work_days == [0, 4]
    assert EmployeeUpdate(work_days=[4, 0]).work_days == [0, 4]

    with pytest.raises(ValidationError):
        EmployeeCreate(
            name="Test",
            job_title="Test",
            base_salary=1,
            hire_date="2026-11-01",
            work_days=[],
        )

    with pytest.raises(ValidationError):
        EmployeeUpdate(work_days=[0, 0])
