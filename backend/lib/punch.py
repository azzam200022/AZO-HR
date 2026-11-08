"""Shared punch logic so the manager console and the employee portal enforce the same
rules — geofence, shift window, lateness, and time spent away from the site."""

import os
from datetime import date as date_type, datetime, time as time_type, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from lib.dates import now_local, now_time, today_iso
from lib.db import db
from lib.geo import haversine_m
from lib.notify import notify_late, notify_left_site, notify_manager_event
from lib.shift import (
    EARLY_PUNCH_WINDOW_MINUTES,
    employee_shift,
    is_working_day,
    late_minutes,
    minutes_since_start,
    shift_has_ended,
    shift_minutes,
    shift_not_started,
    away_minutes_at,
    effective_away_minutes,
    to_minutes,
)
from models.hr import AttendanceRecord


async def _employee_location(employee: dict) -> dict | None:
    location_id = employee.get("location_id") or ""
    if not location_id:
        return None
    return await db.locations.find_one({"id": location_id})


def require_tracking_consent(employee: dict) -> None:
    if not employee.get("background_tracking_consent", False):
        raise HTTPException(
            status_code=403,
            detail="فعّل «تتبع الموقع أثناء الدوام» من ملفك الشخصي قبل تسجيل الحضور.",
        )


async def _attendance_for_shift(
    employee_id: str, work_date: str, shift_start: str, shift_end: str
) -> tuple[dict | None, str]:
    """Find today's punch, or the previous day's open punch for an overnight shift."""
    doc = await db.attendance.find_one({"employee_id": employee_id, "date": work_date})
    if doc or to_minutes(shift_end) > to_minutes(shift_start):
        return doc, work_date

    previous_date = (date_type.fromisoformat(work_date) - timedelta(days=1)).isoformat()
    previous = await db.attendance.find_one(
        {"employee_id": employee_id, "date": previous_date}
    )
    if previous and not previous.get("check_out"):
        return previous, previous_date
    return None, work_date


def _enforce_geofence(location_doc: dict | None, lat: float | None, lng: float | None) -> float | None:
    if not location_doc:
        return None
    if lat is None or lng is None:
        raise HTTPException(
            status_code=400,
            detail="تسجيل الحضور يتطلب تحديد موقعك الجغرافي — فعّل صلاحية الموقع في المتصفح",
        )
    distance = haversine_m(lat, lng, location_doc["latitude"], location_doc["longitude"])
    allowed = location_doc.get("radius_m", 150)
    if distance > allowed:
        raise HTTPException(
            status_code=403,
            detail=(
                f"أنت خارج نطاق موقع العمل «{location_doc['name']}» — "
                f"الحضور مسموح فقط ضمن {allowed} متراً منه"
            ),
        )
    return distance


async def punch_in(
    employee: dict, lat: float | None, lng: float | None, *, notify_manager: bool = True
) -> AttendanceRecord:
    shift_start, shift_end, grace = employee_shift(employee)
    punched_at_local = now_local()
    punched_at = punched_at_local.strftime("%H:%M")
    punched_at_utc = punched_at_local.astimezone(timezone.utc)
    work_date = punched_at_local.date()
    if to_minutes(shift_end) <= to_minutes(shift_start) and to_minutes(punched_at) <= to_minutes(shift_end):
        work_date -= timedelta(days=1)
    date = work_date.isoformat()

    # The shift window closes the door: no check-in after the employee's own shift ended.
    if shift_has_ended(punched_at, shift_start, shift_end):
        raise HTTPException(
            status_code=403,
            detail=(
                f"انتهت فترة دوامك ({shift_start} إلى {shift_end}) — لا يمكن تسجيل الحضور بعد "
                "انتهاء الدوام. راجع مدير النظام لتسجيل يدوي."
            ),
        )
    if shift_not_started(punched_at, shift_start):
        raise HTTPException(
            status_code=403,
            detail=(
                f"لم يبدأ دوامك بعد ({shift_start} إلى {shift_end}) — يمكنك تسجيل الحضور قبل "
                f"بداية الدوام بمدة {EARLY_PUNCH_WINDOW_MINUTES // 60} ساعتين كحد أقصى."
            ),
        )

    location_doc = await _employee_location(employee)
    distance = _enforce_geofence(location_doc, lat, lng)

    if await db.attendance.find_one({"employee_id": employee["id"], "date": date}):
        raise HTTPException(status_code=409, detail="تم تسجيل الحضور مسبقاً لهذا اليوم")

    late = late_minutes(
        punched_at,
        shift_start,
        grace,
        work_date=date,
        work_days=employee.get("work_days"),
    )
    record = AttendanceRecord(
        employee_id=employee["id"],
        date=date,
        check_in=punched_at,
        check_in_at=punched_at_utc,
        location_id=location_doc["id"] if location_doc else "",
        distance_m=round(distance, 1) if distance is not None else None,
        late_minutes=late,
        last_seen=punched_at,
    )
    await db.attendance.insert_one(record.model_dump())
    if notify_manager:
        if late > 0:
            await notify_late(employee, late, shift_start, punched_at)
        else:
            await notify_manager_event(
                kind="attendance",
                employee=employee,
                date=date,
                message=f"سجّل {employee.get('name', '')} الحضور الساعة {punched_at}.",
            )
    return record


def _close_away_interval(
    doc: dict,
    now: str,
    shift_start: str,
    shift_end: str,
    *,
    closed_at: datetime | None = None,
) -> dict:
    """Fold an open away interval into away_minutes, capped at the shift end."""
    if not (doc.get("outside_since") or ""):
        return {}
    updates = {
        "away_minutes": away_minutes_at(doc, now, shift_start, shift_end),
        "outside_since": "",
        "outside_since_at": "",
    }
    intervals = list(doc.get("away_intervals") or [])
    open_interval = next((item for item in reversed(intervals) if not item.get("closed_at")), None)
    if open_interval:
        total = updates["away_minutes"]
        open_interval["minutes"] = max(0, total - int(doc.get("away_minutes", 0)))
        open_interval["closed_at"] = (
            closed_at.isoformat(timespec="seconds")
            if closed_at
            else _wall_time_iso(doc.get("date", today_iso()), now, shift_start, shift_end)
        )
        open_interval["ended_by"] = "check_out"
        updates["away_intervals"] = intervals
    return updates


def _app_timezone() -> ZoneInfo:
    return ZoneInfo(os.environ.get("APP_TZ") or "Asia/Baghdad")


def _wall_time_iso(work_date: str, hhmm: str, shift_start: str, shift_end: str) -> str:
    day = date_type.fromisoformat(work_date)
    clock = time_type.fromisoformat(hhmm)
    if to_minutes(shift_end) <= to_minutes(shift_start) and to_minutes(hhmm) < to_minutes(shift_start):
        day += timedelta(days=1)
    return datetime.combine(day, clock, tzinfo=_app_timezone()).isoformat(timespec="seconds")


def _parse_local_instant(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_app_timezone())
    return parsed.astimezone(_app_timezone())


def _shift_end_local(work_date: str, shift_start: str, shift_end: str) -> datetime:
    day = date_type.fromisoformat(work_date)
    if to_minutes(shift_end) <= to_minutes(shift_start):
        day += timedelta(days=1)
    return datetime.combine(
        day,
        time_type.fromisoformat(shift_end),
        tzinfo=_app_timezone(),
    )


def _open_interval(
    doc: dict,
    intervals: list[dict],
    attendance_date: str,
    shift_start: str,
    shift_end: str,
) -> dict | None:
    interval = next((item for item in reversed(intervals) if not item.get("closed_at")), None)
    if interval or not (doc.get("outside_since") or ""):
        return interval

    # Older attendance documents only have the HH:MM state. Reconstruct its local instant
    # so the first synced batch can close that interval without losing its earlier minutes.
    left_at = doc.get("outside_since_at") or _wall_time_iso(
        attendance_date, doc["outside_since"], shift_start, shift_end
    )
    interval = {
        "left_at": left_at,
        "left_lat": None,
        "left_lng": None,
        "left_distance_m": None,
        "left_accuracy_m": None,
        "returned_at": "",
        "return_lat": None,
        "return_lng": None,
        "return_distance_m": None,
        "return_accuracy_m": None,
        "closed_at": "",
        "ended_by": "",
        "minutes": 0,
    }
    intervals.append(interval)
    return interval


async def punch_out(employee_id: str, *, notify_manager: bool = True) -> dict:
    work_date = today_iso()
    employee = await db.employees.find_one({"id": employee_id})
    shift_start, shift_end, _grace = employee_shift(employee or {})
    doc, attendance_date = await _attendance_for_shift(
        employee_id, work_date, shift_start, shift_end
    )
    if not doc:
        raise HTTPException(status_code=404, detail="لا يوجد تسجيل حضور لهذا اليوم")
    if doc.get("check_out"):
        raise HTTPException(status_code=409, detail="تم تسجيل الانصراف مسبقاً")
    checkout_local = now_local()
    now = checkout_local.strftime("%H:%M")
    updates = {
        "check_out": now,
        "check_out_at": checkout_local.isoformat(timespec="seconds"),
        "last_seen": now,
        **_close_away_interval(
            doc, now, shift_start, shift_end, closed_at=checkout_local
        ),
    }
    await db.attendance.update_one({"id": doc["id"]}, {"$set": updates})
    fresh = await db.attendance.find_one({"id": doc["id"]})
    if notify_manager and employee:
        await notify_manager_event(
            kind="attendance",
            employee=employee,
            date=attendance_date,
            message=f"سجّل {employee.get('name', '')} الانصراف الساعة {now}.",
        )
    return fresh

async def record_presence(
    employee: dict,
    lat: float | None,
    lng: float | None,
    *,
    observed_at: datetime | None = None,
    event_id: str | None = None,
    accuracy_m: float | None = None,
) -> dict:
    """Heartbeat from the employee portal while punched in.

    Leaving the work location during a scheduled shift accrues away_minutes. A departure
    first observed after the shift ends closes the attendance record as a checkout instead.
    Historical timestamps are used only by the authenticated offline-sync route.
    """
    shift_start, shift_end, _grace = employee_shift(employee)
    if observed_at is None:
        calendar_date = today_iso()
        now = now_time()
        observed_local = datetime.combine(
            date_type.fromisoformat(calendar_date),
            time_type.fromisoformat(now),
            tzinfo=_app_timezone(),
        )
        event_timestamp_ms = None
    else:
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=timezone.utc)
        observed_local = observed_at.astimezone(_app_timezone())
        calendar_date = observed_local.date().isoformat()
        now = observed_local.strftime("%H:%M")
        event_timestamp_ms = int(observed_at.timestamp() * 1000)
    work_date = calendar_date
    doc, attendance_date = await _attendance_for_shift(
        employee["id"], work_date, shift_start, shift_end
    )
    if not doc:
        raise HTTPException(status_code=404, detail="لا يوجد تسجيل حضور لهذا اليوم")
    if doc.get("check_out"):
        if observed_at is None:
            raise HTTPException(status_code=409, detail="تم تسجيل الانصراف — لا حاجة لتتبع الموقع")
        checkout_at = _parse_local_instant(doc.get("check_out_at")) or datetime.fromisoformat(
            _wall_time_iso(attendance_date, doc["check_out"], shift_start, shift_end)
        )
        if observed_local > checkout_at:
            return {**doc, "_inside": True, "_distance": None, "_tracking": False, "_ignored": True}

    if event_id and event_timestamp_ms is not None:
        cursor_ms = int(doc.get("_presence_cursor_ms", 0))
        if event_timestamp_ms <= cursor_ms:
            return {**doc, "_inside": True, "_distance": None, "_tracking": True, "_duplicate": True}

    location_doc = await _employee_location(employee)

    if not location_doc:
        updates = {"last_seen": now}
        if event_id and event_timestamp_ms is not None:
            updates["_presence_cursor_ms"] = event_timestamp_ms
        await db.attendance.update_one({"id": doc["id"]}, {"$set": updates})
        return {**doc, "last_seen": now, "_inside": True, "_distance": None, "_tracking": False}

    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="تعذر تحديد موقعك الجغرافي")

    now = observed_local.strftime("%H:%M")
    distance = haversine_m(lat, lng, location_doc["latitude"], location_doc["longitude"])
    inside = distance <= location_doc.get("radius_m", 150)
    scheduled_day = is_working_day(attendance_date, employee.get("work_days"))
    elapsed = minutes_since_start(now, shift_start)
    duration = shift_minutes(shift_start, shift_end)
    within_window = scheduled_day and 0 <= elapsed <= duration
    after_shift = scheduled_day and elapsed > duration

    updates: dict = {"last_seen": now}
    if event_id and event_timestamp_ms is not None:
        updates["_presence_cursor_ms"] = event_timestamp_ms
    intervals = list(doc.get("away_intervals") or [])
    open_interval = _open_interval(doc, intervals, attendance_date, shift_start, shift_end)
    interval_start = _parse_local_instant(
        doc.get("outside_since_at") or (open_interval or {}).get("left_at")
    )

    if inside:
        if doc.get("outside_since") and open_interval:
            shift_end_at = _shift_end_local(attendance_date, shift_start, shift_end)
            billable_end = min(observed_local, shift_end_at)
            started_at = interval_start or observed_local
            minutes_away = max(0, int((billable_end - started_at).total_seconds() // 60))
            open_interval.update(
                {
                    "returned_at": observed_local.isoformat(timespec="seconds"),
                    "return_lat": lat,
                    "return_lng": lng,
                    "return_distance_m": round(distance, 1),
                    "return_accuracy_m": accuracy_m,
                    "closed_at": observed_local.isoformat(timespec="seconds"),
                    "ended_by": "return",
                    "minutes": minutes_away,
                }
            )
            updates.update(
                {
                    "away_minutes": int(doc.get("away_minutes", 0)) + minutes_away,
                    "outside_since": "",
                    "outside_since_at": "",
                    "away_intervals": intervals,
                }
            )
        elif doc.get("outside_since"):
            updates.update(
                _close_away_interval(
                    doc, now, shift_start, shift_end, closed_at=observed_local
                )
            )
    elif after_shift and doc.get("outside_since"):
        # A departure that began during the shift is charged only through shift end. If the
        # employee is still outside then, close the day at the scheduled end and stop tracking.
        if open_interval:
            shift_end_at = _shift_end_local(attendance_date, shift_start, shift_end)
            started_at = interval_start or shift_end_at
            minutes_away = max(0, int((shift_end_at - started_at).total_seconds() // 60))
            open_interval.update(
                {
                    "closed_at": shift_end_at.isoformat(timespec="seconds"),
                    "ended_by": "shift_end",
                    "minutes": minutes_away,
                }
            )
            updates.update(
                {
                    "away_minutes": int(doc.get("away_minutes", 0)) + minutes_away,
                    "outside_since": "",
                    "outside_since_at": "",
                    "away_intervals": intervals,
                }
            )
        else:
            updates.update(
                _close_away_interval(
                    doc,
                    shift_end,
                    shift_start,
                    shift_end,
                    closed_at=_shift_end_local(
                        attendance_date, shift_start, shift_end
                    ),
                )
            )
        updates["check_out"] = shift_end
        updates["check_out_at"] = _shift_end_local(
            attendance_date, shift_start, shift_end
        ).isoformat(timespec="seconds")
    elif after_shift:
        # A new departure first observed after shift end is recorded at the location heartbeat.
        updates.update(
            {
                "check_out": now,
                "check_out_at": observed_local.isoformat(timespec="seconds"),
                "outside_since": "",
            }
        )
    elif within_window and not doc.get("outside_since"):
        updates["outside_since"] = now
        left_at = observed_local.isoformat(timespec="seconds")
        updates["outside_since_at"] = left_at
        intervals.append(
            {
                "left_at": left_at,
                "left_lat": lat,
                "left_lng": lng,
                "left_distance_m": round(distance, 1),
                "left_accuracy_m": accuracy_m,
                "returned_at": "",
                "return_lat": None,
                "return_lng": None,
                "return_distance_m": None,
                "return_accuracy_m": None,
                "closed_at": "",
                "ended_by": "",
                "minutes": 0,
            }
        )
        updates["away_intervals"] = intervals
        # One alert per departure — re-entering and leaving again raises a fresh one.
        await notify_left_site(employee, location_doc["name"], now, distance)
    elif event_id and event_timestamp_ms is not None:
        # Persist cursor progress even when the sample is outside the scheduled window.
        pass

    await db.attendance.update_one({"id": doc["id"]}, {"$set": updates})
    fresh = await db.attendance.find_one({"id": doc["id"]})
    if updates.get("check_out") and not doc.get("check_out"):
        await notify_manager_event(
            kind="attendance",
            employee=employee,
            date=attendance_date,
            message=f"سُجّل انصراف {employee.get('name', '')} تلقائياً الساعة {updates['check_out']}.",
        )
    if fresh.get("outside_since"):
        if event_id and interval_start:
            shift_end_at = _shift_end_local(attendance_date, shift_start, shift_end)
            billable_end = min(observed_local, shift_end_at)
            fresh["away_minutes"] = int(fresh.get("away_minutes", 0)) + max(
                0, int((billable_end - interval_start).total_seconds() // 60)
            )
        else:
            fresh["away_minutes"] = effective_away_minutes(
                fresh, now, calendar_date, shift_start, shift_end
            )
    return {**fresh, "_inside": inside, "_distance": distance, "_tracking": True}
