from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from lib.shift_reminders import (
    due_shift_end_reminders,
    due_shift_reminders,
    run_shift_reminder_cycle,
)

ZONE = ZoneInfo("Asia/Baghdad")


@pytest.mark.parametrize(
    ("now", "lead_minutes"),
    [
        ("07:00:30", 60),
        ("07:30:30", 30),
        ("07:45:30", 15),
    ],
)
def test_shift_reminders_follow_the_employee_start_time(now, lead_minutes):
    employee = {
        "shift_start": "08:00",
        "shift_end": "16:00",
        "work_days": list(range(7)),
    }
    current = datetime.fromisoformat(f"2026-11-09T{now}").replace(tzinfo=ZONE)

    assert due_shift_reminders(employee, current) == [
        ("2026-11-09", "08:00", lead_minutes)
    ]


def test_midnight_shift_uses_the_workday_of_the_upcoming_shift():
    employee = {
        "shift_start": "00:30",
        "shift_end": "08:30",
        "work_days": [0],  # Monday
    }
    current = datetime(2026, 11, 8, 23, 30, 30, tzinfo=ZONE)  # Sunday

    assert due_shift_reminders(employee, current) == [
        ("2026-11-09", "00:30", 60)
    ]


def test_reminders_skip_days_off_and_the_end_of_the_grace_window():
    employee = {
        "shift_start": "08:00",
        "shift_end": "16:00",
        "work_days": [1],  # Tuesday, not Monday
    }
    monday = datetime(2026, 11, 9, 7, 0, 30, tzinfo=ZONE)
    late = datetime(2026, 11, 10, 7, 2, 0, tzinfo=ZONE)

    assert due_shift_reminders(employee, monday) == []
    assert due_shift_reminders({**employee, "work_days": [1, 0]}, late) == []


def test_shift_end_reminder_fires_at_the_scheduled_end():
    employee = {
        "shift_start": "08:00",
        "shift_end": "16:00",
        "work_days": list(range(7)),
    }
    before_end = datetime(2026, 11, 9, 15, 59, 59, tzinfo=ZONE)
    at_end = datetime(2026, 11, 9, 16, 0, 30, tzinfo=ZONE)

    assert due_shift_end_reminders(employee, before_end) == []
    assert due_shift_end_reminders(employee, at_end) == [("2026-11-09", "16:00")]


def test_overnight_shift_end_reminder_uses_the_previous_work_date():
    employee = {
        "shift_start": "16:00",
        "shift_end": "00:00",
        "work_days": [0],  # Monday
    }
    at_end = datetime(2026, 11, 10, 0, 0, 30, tzinfo=ZONE)  # Tuesday

    assert due_shift_end_reminders(employee, at_end) == [("2026-11-09", "00:00")]


def test_shift_end_reminder_skips_days_off():
    employee = {
        "shift_start": "08:00",
        "shift_end": "16:00",
        "work_days": [1],  # Tuesday, not Monday
    }
    at_end = datetime(2026, 11, 9, 16, 0, 30, tzinfo=ZONE)

    assert due_shift_end_reminders(employee, at_end) == []


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
        self.queries = []

    def find(self, query, projection=None):
        return _Cursor(self.documents)

    async def find_one(self, query):
        self.queries.append(query)
        for document in self.documents:
            matches = True
            for key, expected in query.items():
                actual = document.get(key)
                if isinstance(expected, dict):
                    if actual is None:
                        matches = False
                        break
                    if "$lte" in expected and not actual <= expected["$lte"]:
                        matches = False
                        break
                    if "$gte" in expected and not actual >= expected["$gte"]:
                        matches = False
                        break
                elif actual != expected:
                    matches = False
                    break
            if matches:
                return document
        return None


@pytest.mark.asyncio
async def test_cycle_sends_only_for_employees_not_checked_in_or_on_leave():
    employees = _Collection(
        [
            {
                "id": "ready",
                "name": "جاهز",
                "status": "active",
                "can_login": True,
                "shift_start": "08:00",
                "shift_end": "16:00",
                "work_days": list(range(7)),
            },
            {
                "id": "checked-in",
                "status": "active",
                "shift_start": "08:00",
                "work_days": list(range(7)),
            },
            {
                "id": "on-leave",
                "status": "active",
                "shift_start": "08:00",
                "work_days": list(range(7)),
            },
        ]
    )
    database = type(
        "Database",
        (),
        {
            "employees": employees,
            "attendance": _Collection(
                [{"employee_id": "checked-in", "date": "2026-11-09", "check_in": "07:50"}]
            ),
            "leaves": _Collection(
                [
                    {
                        "employee_id": "on-leave",
                        "status": "approved",
                        "start_date": "2026-11-09",
                        "end_date": "2026-11-09",
                    }
                ]
            ),
        },
    )()
    sent = []

    async def sender(**kwargs):
        sent.append(kwargs)

    now = datetime(2026, 11, 9, 7, 0, 30, tzinfo=ZONE)
    attempted = await run_shift_reminder_cycle(
        now,
        database=database,
        reminder_sender=sender,
    )

    assert attempted == 1
    assert [item["employee"]["id"] for item in sent] == ["ready"]
    assert sent[0]["minutes_before"] == 60


@pytest.mark.asyncio
async def test_cycle_sends_end_reminder_only_for_checked_in_employees_without_checkout():
    employees = _Collection(
        [
            {
                "id": "ready",
                "name": "جاهز",
                "status": "active",
                "shift_start": "08:00",
                "shift_end": "16:00",
                "work_days": list(range(7)),
            },
            {
                "id": "checked-out",
                "status": "active",
                "shift_start": "08:00",
                "shift_end": "16:00",
                "work_days": list(range(7)),
            },
            {
                "id": "not-checked-in",
                "status": "active",
                "shift_start": "08:00",
                "shift_end": "16:00",
                "work_days": list(range(7)),
            },
            {
                "id": "on-leave",
                "status": "active",
                "shift_start": "08:00",
                "shift_end": "16:00",
                "work_days": list(range(7)),
            },
        ]
    )
    database = type(
        "Database",
        (),
        {
            "employees": employees,
            "attendance": _Collection(
                [
                    {
                        "employee_id": "ready",
                        "date": "2026-11-09",
                        "check_in": "08:00",
                    },
                    {
                        "employee_id": "checked-out",
                        "date": "2026-11-09",
                        "check_in": "08:00",
                        "check_out": "15:50",
                    },
                    {"employee_id": "on-leave", "date": "2026-11-09", "check_in": "08:00"},
                ]
            ),
            "leaves": _Collection(
                [
                    {
                        "employee_id": "on-leave",
                        "status": "approved",
                        "start_date": "2026-11-09",
                        "end_date": "2026-11-09",
                    }
                ]
            ),
        },
    )()
    sent = []

    async def sender(**kwargs):
        sent.append(kwargs)

    now = datetime(2026, 11, 9, 16, 0, 30, tzinfo=ZONE)
    attempted = await run_shift_reminder_cycle(
        now,
        database=database,
        end_reminder_sender=sender,
    )

    assert attempted == 1
    assert [item["employee"]["id"] for item in sent] == ["ready"]
    assert sent[0]["work_date"] == "2026-11-09"
    assert sent[0]["shift_end"] == "16:00"
