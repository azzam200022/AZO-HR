from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


class _Notifications:
    def __init__(self):
        self.documents = []

    async def insert_one(self, document):
        self.documents.append(document)


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
