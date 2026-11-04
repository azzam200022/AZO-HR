"""Shared punch logic so the manager console and the employee portal enforce the same
rules — geofence, shift window, lateness, and time spent away from the site."""

from datetime import date as date_type, timedelta

from fastapi import HTTPException

from lib.dates import now_time, today_iso
from lib.db import db
from lib.geo import haversine_m
from lib.notify import notify_late, notify_left_site
from lib.shift import (
    EARLY_PUNCH_WINDOW_MINUTES,
    employee_shift,
    is_working_day,
    late_minutes,
    minutes_since_start,
    shift_has_ended,
    shift_minutes,
    shift_not_started,
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


async def punch_in(employee: dict, lat: float | None, lng: float | None) -> AttendanceRecord:
    shift_start, shift_end, grace = employee_shift(employee)
    punched_at = now_time()

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

    date = today_iso()
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
        location_id=location_doc["id"] if location_doc else "",
        distance_m=round(distance, 1) if distance is not None else None,
        late_minutes=late,
        last_seen=punched_at,
    )
    await db.attendance.insert_one(record.model_dump())
    if late > 0:
        await notify_late(employee, late, shift_start, punched_at)
    return record


def _close_away_interval(doc: dict, now: str) -> dict:
    """Fold an open 'outside the site' interval into away_minutes."""
    outside_since = doc.get("outside_since") or ""
    if not outside_since:
        return {}
    start = int(outside_since[:2]) * 60 + int(outside_since[3:5])
    end = int(now[:2]) * 60 + int(now[3:5])
    if end < start:
        end += 24 * 60
    return {
        "away_minutes": int(doc.get("away_minutes", 0)) + (end - start),
        "outside_since": "",
    }


async def punch_out(employee_id: str) -> dict:
    work_date = today_iso()
    employee = await db.employees.find_one({"id": employee_id}) or {}
    shift_start, shift_end, _grace = employee_shift(employee)
    doc, _attendance_date = await _attendance_for_shift(
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
    return await db.attendance.find_one({"id": doc["id"]})

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
    elif after_shift:
        # The clock alone never checks out an employee; an observed site exit does.
        # Close any earlier absence at shift end, then record this departure as checkout.
        updates.update(_close_away_interval(doc, now, shift_start, shift_end))
        updates.update({"check_out": now, "outside_since": ""})
    elif within_window and not doc.get("outside_since"):
        updates["outside_since"] = now
        # One alert per departure — re-entering and leaving again raises a fresh one.
        await notify_left_site(employee, location_doc["name"], now, distance)

    await db.attendance.update_one({"id": doc["id"]}, {"$set": updates})
    fresh = await db.attendance.find_one({"id": doc["id"]})
    return {**fresh, "_inside": inside, "_distance": distance, "_tracking": True}
