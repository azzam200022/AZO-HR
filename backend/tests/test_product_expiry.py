from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from lib.product_expiry import (
    due_expiry_reminders,
    expiry_status,
    one_calendar_month_before,
    run_product_expiry_reminder_cycle,
)
from models.hr import EmployeeProductCreate


class _Cursor:
    def __init__(self, documents):
        self.documents = iter(documents)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.documents)
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self, documents=()):
        self.documents = list(documents)

    def find(self, _query, _projection=None):
        return _Cursor(self.documents)

    async def find_one(self, query):
        return next(
            (document for document in self.documents if document.get("id") == query.get("id")),
            None,
        )


def test_employee_product_accepts_multiple_valid_expiry_dates():
    product = EmployeeProductCreate(
        name="  حليب  ",
        expiry_dates=["2026-12-15", "2027-01-10"],
    )

    assert product.name == "حليب"
    assert product.expiry_dates == ["2026-12-15", "2027-01-10"]


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "حليب", "expiry_dates": []},
        {"name": " ", "expiry_dates": ["2026-12-15"]},
        {"name": "حليب", "expiry_dates": ["2026-02-30"]},
        {"name": "حليب", "expiry_dates": ["2026-12-15", "2026-12-15"]},
    ],
)
def test_employee_product_rejects_invalid_or_duplicate_expiry_dates(payload):
    with pytest.raises(ValidationError):
        EmployeeProductCreate(**payload)


def test_one_month_reminder_clamps_to_the_last_day_of_shorter_month():
    assert one_calendar_month_before(date(2024, 3, 31)) == date(2024, 2, 29)
    assert one_calendar_month_before(date(2026, 3, 31)) == date(2026, 2, 28)


@pytest.mark.parametrize(
    ("expiry", "today", "expected"),
    [
        ("2026-12-15", date(2026, 11, 15), [("month", "شهر")]),
        ("2026-11-30", date(2026, 11, 15), [("15", "15 يومًا")]),
        ("2026-11-25", date(2026, 11, 15), [("10", "10 أيام")]),
        ("2026-11-22", date(2026, 11, 15), [("7", "7 أيام")]),
        ("2026-11-21", date(2026, 11, 15), []),
    ],
)
def test_expiry_reminders_are_due_on_the_requested_lead_dates(expiry, today, expected):
    assert due_expiry_reminders(expiry, today) == expected


@pytest.mark.parametrize(
    ("days_remaining", "expected"),
    [(31, "far"), (30, "near"), (0, "near"), (-1, "expired")],
)
def test_expiry_color_status_thresholds(days_remaining, expected):
    assert expiry_status(days_remaining) == expected


@pytest.mark.asyncio
async def test_reminder_cycle_targets_only_the_active_product_owner():
    database = SimpleNamespace(
        employee_products=_Collection(
            [
                {
                    "id": "product-1",
                    "employee_id": "employee-1",
                    "name": "حليب",
                    "expiry_dates": [{"id": "batch-1", "expiry_date": "2026-12-15"}],
                },
                {
                    "id": "product-2",
                    "employee_id": "employee-2",
                    "name": "جبن",
                    "expiry_dates": [{"id": "batch-2", "expiry_date": "2026-12-15"}],
                },
            ]
        ),
        employees=_Collection(
            [
                {"id": "employee-1", "name": "الموظف الأول", "status": "active"},
                {"id": "employee-2", "name": "الموظف الثاني", "status": "inactive"},
            ]
        ),
    )
    send = AsyncMock()

    attempted = await run_product_expiry_reminder_cycle(
        date(2026, 11, 15),
        database=database,
        reminder_sender=send,
    )

    assert attempted == 1
    send.assert_awaited_once_with(
        employee={"id": "employee-1", "name": "الموظف الأول", "status": "active"},
        product_id="product-1",
        product_name="حليب",
        batch_id="batch-1",
        expiry_date="2026-12-15",
        reminder_key="month",
        reminder_label="شهر",
    )
