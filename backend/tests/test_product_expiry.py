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
from models.hr import EmployeeProductCreate, EmployeeProductUpdate


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
        custom_reminder_days=5,
    )

    assert product.name == "حليب"
    assert product.expiry_dates == ["2026-12-15", "2027-01-10"]
    assert product.custom_reminder_days == 5


def test_employee_product_update_accepts_name_new_date_and_custom_reminder():
    update = EmployeeProductUpdate(
        name="  لبن  ",
        add_expiry_date="2026-12-20",
        custom_reminder_days=4,
    )

    assert update.name == "لبن"
    assert update.add_expiry_date == "2026-12-20"
    assert update.custom_reminder_days == 4


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


@pytest.mark.parametrize("days", [0, 366, -1])
def test_employee_product_rejects_out_of_range_custom_reminder(days):
    with pytest.raises(ValidationError):
        EmployeeProductCreate(
            name="حليب",
            expiry_dates=["2026-12-15"],
            custom_reminder_days=days,
        )


@pytest.mark.parametrize("expiry_date", ["2026-02-30", "15-12-2026", ""])
def test_employee_product_update_rejects_invalid_added_expiry_date(expiry_date):
    with pytest.raises(ValidationError):
        EmployeeProductUpdate(add_expiry_date=expiry_date)


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


def test_custom_expiry_reminder_is_added_alongside_default_reminders():
    assert due_expiry_reminders(
        "2026-12-15",
        date(2026, 12, 11),
        custom_reminder_days=4,
    ) == [("custom-4", "4 أيام")]


@pytest.mark.parametrize(
    ("expiry", "custom_days", "today", "expected"),
    [
        ("2026-12-15", 7, date(2026, 12, 8), [("7", "7 أيام")]),
        ("2026-12-15", 30, date(2026, 11, 15), [("month", "شهر")]),
    ],
)
def test_custom_expiry_reminder_does_not_duplicate_a_default_date(
    expiry,
    custom_days,
    today,
    expected,
):
    assert due_expiry_reminders(expiry, today, custom_days) == expected


@pytest.mark.asyncio
async def test_reminder_cycle_skips_handled_expiry_batches():
    database = SimpleNamespace(
        employee_products=_Collection(
            [
                {
                    "id": "product-1",
                    "employee_id": "employee-1",
                    "name": "حليب",
                    "expiry_dates": [
                        {
                            "id": "batch-handled",
                            "expiry_date": "2026-12-15",
                            "handled": True,
                        },
                        {"id": "batch-open", "expiry_date": "2026-12-15"},
                    ],
                }
            ]
        ),
        employees=_Collection(
            [{"id": "employee-1", "name": "موظف", "status": "active"}]
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
        employee={"id": "employee-1", "name": "موظف", "status": "active"},
        product_id="product-1",
        product_name="حليب",
        batch_id="batch-open",
        expiry_date="2026-12-15",
        reminder_key="month",
        reminder_label="شهر",
    )


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


@pytest.mark.asyncio
async def test_reminder_cycle_sends_a_custom_reminder_for_the_product():
    database = SimpleNamespace(
        employee_products=_Collection(
            [
                {
                    "id": "product-1",
                    "employee_id": "employee-1",
                    "name": "لبن",
                    "custom_reminder_days": 4,
                    "expiry_dates": [{"id": "batch-1", "expiry_date": "2026-12-15"}],
                }
            ]
        ),
        employees=_Collection(
            [{"id": "employee-1", "name": "موظف", "status": "active"}]
        ),
    )
    send = AsyncMock()

    attempted = await run_product_expiry_reminder_cycle(
        date(2026, 12, 11),
        database=database,
        reminder_sender=send,
    )

    assert attempted == 1
    send.assert_awaited_once_with(
        employee={"id": "employee-1", "name": "موظف", "status": "active"},
        product_id="product-1",
        product_name="لبن",
        batch_id="batch-1",
        expiry_date="2026-12-15",
        reminder_key="custom-4",
        reminder_label="4 أيام",
    )
