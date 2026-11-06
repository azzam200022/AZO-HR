"""Shared punch logic so the manager console and the employee portal enforce the same
rules — geofence, shift window, lateness, and time spent away from the site."""

from datetime import date as date_type, timedelta, timezone

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


def _close_away_interval(doc: dict, now: str, shift_start: str, shift_end: str) -> dict:
    """Fold an open away interval into away_minutes, capped at the shift end."""
    if not (doc.get("outside_since") or ""):
        return {}
    return {
        "away_minutes": away_minutes_at(doc, now, shift_start, shift_end),
        "outside_since": "",
    }

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
    now = now_time()
    updates = {
        "check_out": now,
        "last_seen": now,
        **_close_away_interval(doc, now, shift_start, shift_end),
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

async def record_presence(employee: dict, lat: float | None, lng: float | None) -> dict:
    """Heartbeat from the employee portal while punched in.

    Leaving the work location during a scheduled shift accrues away_minutes. A departure
    first observed after the shift ends closes the attendance record as a checkout instead.
    """
    work_date = today_iso()
    shift_start, shift_end, _grace = employee_shift(employee)
    doc, attendance_date = await _attendance_for_shift(
        employee["id"], work_date, shift_start, shift_end
    )
    if not doc:
        raise HTTPException(status_code=404, detail="لا يوجد تسجيل حضور لهذا اليوم")
    if doc.get("check_out"):
        raise HTTPException(status_code=409, detail="تم تسجيل الانصراف — لا حاجة لتتبع الموقع")

    location_doc = await _employee_location(employee)
    now = now_time()

    if not location_doc:
        await db.attendance.update_one({"id": doc["id"]}, {"$set": {"last_seen": now}})
        return {**doc, "last_seen": now, "_inside": True, "_distance": None, "_tracking": False}

    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="تعذر تحديد موقعك الجغرافي")

    distance = haversine_m(lat, lng, location_doc["latitude"], location_doc["longitude"])
    inside = distance <= location_doc.get("radius_m", 150)
    scheduled_day = is_working_day(attendance_date, employee.get("work_days"))
    elapsed = minutes_since_start(now, shift_start)
    duration = shift_minutes(shift_start, shift_end)
    within_window = scheduled_day and 0 <= elapsed <= duration
    after_shift = scheduled_day and elapsed > duration

    updates: dict = {"last_seen": now}
    if inside:
        updates.update(_close_away_interval(doc, now, shift_start, shift_end))
    elif after_shift and doc.get("outside_since"):
        # A departure that began during the shift is charged only through shift end. If the
        # employee is still outside then, close the day at the scheduled end and stop tracking.
        updates.update(_close_away_interval(doc, shift_end, shift_start, shift_end))
        updates["check_out"] = shift_end
    elif after_shift:
        # A new departure first observed after shift end is recorded at the location heartbeat.
        updates.update({"check_out": now, "outside_since": ""})
    elif within_window and not doc.get("outside_since"):
        updates["outside_since"] = now
        # One alert per departure — re-entering and leaving again raises a fresh one.
        await notify_left_site(employee, location_doc["name"], now, distance)

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
        fresh["away_minutes"] = effective_away_minutes(
            fresh, now, today_iso(), shift_start, shift_end
        )
    return {**fresh, "_inside": inside, "_distance": distance, "_tracking": True}
