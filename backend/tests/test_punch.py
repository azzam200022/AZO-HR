from copy import deepcopy
from datetime import datetime
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock
import sys
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException


# Keep punch tests independent of a live database and outbound notifications.
_MISSING_MODULE = object()
_previous_modules = {
    name: sys.modules.get(name, _MISSING_MODULE)
    for name in ("lib.db", "lib.notify")
}

database_module = ModuleType("lib.db")
database_module.db = SimpleNamespace()
sys.modules["lib.db"] = database_module

notification_module = ModuleType("lib.notify")
async def _noop_notification(*_args, **_kwargs):
    return None
notification_module.notify_late = _noop_notification
notification_module.notify_left_site = _noop_notification
notification_module.notify_manager_event = _noop_notification
sys.modules["lib.notify"] = notification_module

try:
    # FastAPI is a backend dependency; do not replace it with a stub visible to other tests.
    from lib import punch
finally:
    for module_name, original in _previous_modules.items():
        if original is _MISSING_MODULE:
            sys.modules.pop(module_name, None)
        else:
            sys.modules[module_name] = original


class MemoryCollection:
    def __init__(self, *documents):
        self.documents = [deepcopy(document) for document in documents]

    async def find_one(self, query):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                return deepcopy(document)
        return None

    async def update_one(self, query, update):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                document.update(deepcopy(update.get("$set", {})))
                return


def make_records(monkeypatch, record, employee, clock, today=None):
    location = {
        "id": "site-1",
        "name": "موقع العمل",
        "latitude": 0,
        "longitude": 0,
        "radius_m": 150,
    }
    database = SimpleNamespace(
        attendance=MemoryCollection(record),
        locations=MemoryCollection(location),
    )
    monkeypatch.setattr(punch, "db", database)
    monkeypatch.setattr(punch, "today_iso", lambda: today or record["date"])
    monkeypatch.setattr(punch, "now_time", lambda: clock["now"])
    monkeypatch.setattr(punch, "haversine_m", lambda *_args: clock["distance"])
    monkeypatch.setattr(punch, "notify_left_site", AsyncMock())
    return database


def attendance_record(**updates):
    return {
        "id": "attendance-1",
        "employee_id": "employee-1",
        "date": "2026-11-04",
        "check_in": "08:00",
        "check_out": "",
        "away_minutes": 0,
        "outside_since": "",
        **updates,
    }


def employee(**updates):
    return {
        "id": "employee-1",
        "location_id": "site-1",
        "shift_start": "08:00",
        "shift_end": "16:00",
        "work_days": list(range(7)),
        **updates,
    }


def test_tracking_consent_is_required_before_employee_self_service():
    with pytest.raises(HTTPException) as error:
        punch.require_tracking_consent(employee())

    assert error.value.status_code == 403
    assert "تتبع الموقع أثناء الدوام" in error.value.detail


def test_enabled_tracking_consent_passes_guard():
    punch.require_tracking_consent(employee(background_tracking_consent=True))


@pytest.mark.asyncio
async def test_presence_counts_minutes_between_midshift_departure_and_return(monkeypatch):
    clock = {"now": "10:00", "distance": 500}
    record = attendance_record()
    staff = employee()
    database = make_records(monkeypatch, record, staff, clock)

    departed = await punch.record_presence(staff, 0, 0)
    assert departed["outside_since"] == "10:00"
    assert departed["away_minutes"] == 0

    clock.update(now="10:25", distance=100)
    returned = await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert returned["_inside"] is True
    assert saved["away_minutes"] == 25
    assert saved["outside_since"] == ""
    assert saved["check_out"] == ""


@pytest.mark.asyncio
async def test_manual_checkout_closes_open_away_interval_at_exact_second(monkeypatch):
    left_at = "2026-11-04T10:00:00+03:00"
    record = attendance_record(
        outside_since="10:00",
        outside_since_at=left_at,
        away_intervals=[
            {
                "left_at": left_at,
                "closed_at": "",
                "returned_at": "",
                "minutes": 0,
            }
        ],
    )
    staff = employee()
    database = make_records(monkeypatch, record, staff, {"now": "10:20", "distance": 500})
    database.employees = MemoryCollection(staff)
    monkeypatch.setattr(
        punch,
        "now_local",
        lambda: datetime.fromisoformat("2026-11-04T10:20:37+03:00"),
    )

    saved = await punch.punch_out(staff["id"], notify_manager=False)

    assert saved["check_out_at"] == "2026-11-04T10:20:37+03:00"
    assert saved["away_intervals"][0]["closed_at"] == "2026-11-04T10:20:37+03:00"


@pytest.mark.asyncio
async def test_offline_location_replay_keeps_departure_return_and_ignores_retries(monkeypatch):
    clock = {"now": "10:00", "distance": 500}
    record = attendance_record()
    staff = employee()
    database = make_records(monkeypatch, record, staff, clock)
    zone = ZoneInfo("Asia/Baghdad")
    left_at = datetime(2026, 11, 4, 10, 0, tzinfo=zone)
    returned_at = datetime(2026, 11, 4, 10, 25, tzinfo=zone)

    await punch.record_presence(
        staff,
        33.3152,
        44.3661,
        observed_at=left_at,
        event_id="left-1",
        accuracy_m=7.5,
    )
    clock.update(now="10:25", distance=100)
    result = await punch.record_presence(
        staff,
        33.3150,
        44.3660,
        observed_at=returned_at,
        event_id="return-1",
        accuracy_m=6.0,
    )

    saved = database.attendance.documents[0]
    assert result["away_minutes"] == 25
    assert saved["away_minutes"] == 25
    assert saved["outside_since"] == ""
    assert saved["_presence_cursor_ms"] == int(returned_at.timestamp() * 1000)
    assert saved["away_intervals"][0]["left_at"] == "2026-11-04T10:00:00+03:00"
    assert saved["away_intervals"][0]["returned_at"] == "2026-11-04T10:25:00+03:00"
    assert saved["away_intervals"][0]["left_lat"] == 33.3152
    assert saved["away_intervals"][0]["return_lng"] == 44.366
    assert saved["away_intervals"][0]["left_accuracy_m"] == 7.5

    duplicate = await punch.record_presence(
        staff,
        33.3152,
        44.3661,
        observed_at=left_at,
        event_id="left-1",
    )
    assert duplicate["_duplicate"] is True
    assert database.attendance.documents[0]["away_minutes"] == 25


@pytest.mark.asyncio
async def test_departure_notification_fires_once_until_employee_returns(monkeypatch):
    clock = {"now": "10:00", "distance": 500}
    record = attendance_record()
    staff = employee()
    make_records(monkeypatch, record, staff, clock)
    notify = AsyncMock()
    monkeypatch.setattr(punch, "notify_left_site", notify)

    await punch.record_presence(staff, 0, 0)
    clock.update(now="10:00", distance=520)
    await punch.record_presence(staff, 0, 0)
    assert notify.await_count == 1

    clock.update(now="10:01", distance=100)
    await punch.record_presence(staff, 0, 0)
    clock.update(now="10:02", distance=500)
    await punch.record_presence(staff, 0, 0)
    assert notify.await_count == 2


@pytest.mark.asyncio
async def test_departure_after_shift_end_records_checkout(monkeypatch):
    clock = {"now": "16:05", "distance": 500}
    record = attendance_record()
    staff = employee()
    database = make_records(monkeypatch, record, staff, clock)

    result = await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert result["check_out"] == "16:05"
    assert saved["check_out"] == "16:05"
    assert saved["away_minutes"] == 0
    assert saved["outside_since"] == ""


@pytest.mark.asyncio
async def test_staying_inside_after_shift_end_does_not_record_checkout(monkeypatch):
    clock = {"now": "16:05", "distance": 100}
    record = attendance_record()
    staff = employee()
    database = make_records(monkeypatch, record, staff, clock)

    await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert saved["check_out"] == ""
    assert saved["away_minutes"] == 0


@pytest.mark.asyncio
async def test_open_midshift_absence_closes_at_shift_end(monkeypatch):
    clock = {"now": "16:05", "distance": 500}
    record = attendance_record(outside_since="15:55")
    staff = employee()
    database = make_records(monkeypatch, record, staff, clock)

    result = await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert result["check_out"] == "16:00"
    assert result["_tracking"] is True
    assert saved["check_out"] == "16:00"
    assert saved["away_minutes"] == 5
    assert saved["outside_since"] == ""


@pytest.mark.asyncio
async def test_midshift_absence_return_after_shift_end_counts_only_to_shift_end(monkeypatch):
    clock = {"now": "16:05", "distance": 100}
    record = attendance_record(outside_since="15:55")
    staff = employee()
    database = make_records(monkeypatch, record, staff, clock)

    await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert saved["check_out"] == ""
    assert saved["away_minutes"] == 5
    assert saved["outside_since"] == ""


@pytest.mark.asyncio
async def test_overnight_departure_after_midnight_closes_previous_day_record(monkeypatch):
    clock = {"now": "00:05", "distance": 500}
    record = attendance_record(date="2026-11-03", check_in="16:00")
    staff = employee(shift_start="16:00", shift_end="00:00")
    database = make_records(monkeypatch, record, staff, clock, today="2026-11-04")

    await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert saved["date"] == "2026-11-03"
    assert saved["check_out"] == "00:05"


def test_overnight_absence_interval_is_capped_at_midnight_shift_end():
    closed = punch._close_away_interval(
        attendance_record(outside_since="23:55"),
        "00:05",
        "16:00",
        "00:00",
    )
    assert closed["away_minutes"] == 5
    assert closed["outside_since"] == ""


@pytest.mark.asyncio
async def test_departure_on_nonworking_day_does_not_auto_checkout(monkeypatch):
    clock = {"now": "17:00", "distance": 500}
    record = attendance_record()
    staff = employee(work_days=[0])  # 2026-11-04 is Wednesday (weekday 2)
    database = make_records(monkeypatch, record, staff, clock)

    await punch.record_presence(staff, 0, 0)
    saved = database.attendance.documents[0]
    assert saved["check_out"] == ""
    assert saved["away_minutes"] == 0
