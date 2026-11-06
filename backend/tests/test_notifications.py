from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


class _Notifications:
    def __init__(self):
        self.documents = []

    async def insert_one(self, document):
        self.documents.append(document)

    async def update_one(self, query, update, upsert=False):
        existing = next(
            (doc for doc in self.documents if doc.get("id") == query.get("id")),
            None,
        )
        if existing:
            return SimpleNamespace(upserted_id=None)
        document = update["$setOnInsert"]
        self.documents.append(document)
        return SimpleNamespace(upserted_id=document["id"])


@pytest.mark.asyncio
async def test_employee_event_is_saved_and_pushed_with_specific_content(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "notifications_test")
    from lib import notify

    notifications = _Notifications()
    send = AsyncMock()
    monkeypatch.setattr(notify, "db", SimpleNamespace(notifications=notifications))
    monkeypatch.setattr(notify, "send_notification", send)

    await notify.notify_employee_event(
        kind="payroll",
        employee={"id": "employee-1", "name": "موظف تجريبي"},
        date="2026-11-06",
        message="تمت تسوية راتبك بصافي 1,000,000 د.ع.",
    )

    assert len(notifications.documents) == 1
    saved = notifications.documents[0]
    assert saved["audience"] == "employee"
    assert saved["employee_id"] == "employee-1"
    assert saved["kind"] == "payroll"
    assert saved["message"] == "تمت تسوية راتبك بصافي 1,000,000 د.ع."
    send.assert_awaited_once_with(saved)


@pytest.mark.asyncio
async def test_shift_reminder_is_persisted_and_pushed_once(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "notifications_test")
    from lib import notify

    notifications = _Notifications()
    send = AsyncMock()
    monkeypatch.setattr(notify, "db", SimpleNamespace(notifications=notifications))
    monkeypatch.setattr(notify, "send_notification", send)

    reminder = {
        "employee": {"id": "employee-1", "name": "موظف تجريبي"},
        "work_date": "2026-11-09",
        "shift_start": "08:00",
        "minutes_before": 60,
    }
    await notify.notify_employee_shift_reminder(**reminder)
    await notify.notify_employee_shift_reminder(**reminder)

    assert len(notifications.documents) == 1
    saved = notifications.documents[0]
    assert saved["id"] == "shift-reminder:employee-1:2026-11-09:60"
    assert saved["kind"] == "shift_reminder"
    assert saved["audience"] == "employee"
    assert saved["message"] == "يبدأ دوامك الساعة 08:00 — تبقّى ساعة."
    send.assert_awaited_once_with(saved)


@pytest.mark.asyncio
async def test_shift_end_reminder_is_persisted_and_pushed_once(monkeypatch):
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    monkeypatch.setenv("DB_NAME", "notifications_test")
    from lib import notify

    notifications = _Notifications()
    send = AsyncMock()
    monkeypatch.setattr(notify, "db", SimpleNamespace(notifications=notifications))
    monkeypatch.setattr(notify, "send_notification", send)

    reminder = {
        "employee": {"id": "employee-1", "name": "موظف تجريبي"},
        "work_date": "2026-11-09",
        "shift_end": "16:00",
    }
    await notify.notify_employee_shift_end_reminder(**reminder)
    await notify.notify_employee_shift_end_reminder(**reminder)

    assert len(notifications.documents) == 1
    saved = notifications.documents[0]
    assert saved["id"] == "shift-end-reminder:employee-1:2026-11-09"
    assert saved["kind"] == "shift_reminder"
    assert saved["audience"] == "employee"
    assert saved["message"] == "ينتهي دوامك الساعة 16:00 — لا تنسَ تسجيل الانصراف."
    send.assert_awaited_once_with(saved)
