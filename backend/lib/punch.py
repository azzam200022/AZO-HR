"""Shared punch logic so the manager console and the employee portal enforce the same
geofence rules — the rule lives here once, not duplicated per router."""

from fastapi import HTTPException

from lib.dates import now_time, today_iso
from lib.db import db
from lib.geo import haversine_m
from models.hr import AttendanceRecord


async def punch_in(employee: dict, lat: float | None, lng: float | None) -> AttendanceRecord:
    location_id = employee.get("location_id") or ""
    location_doc = await db.locations.find_one({"id": location_id}) if location_id else None
    distance: float | None = None

    if location_doc:
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

    date = today_iso()
    if await db.attendance.find_one({"employee_id": employee["id"], "date": date}):
        raise HTTPException(status_code=409, detail="تم تسجيل الحضور مسبقاً لهذا اليوم")

    record = AttendanceRecord(
        employee_id=employee["id"],
        date=date,
        check_in=now_time(),
        location_id=location_doc["id"] if location_doc else "",
        distance_m=round(distance, 1) if distance is not None else None,
    )
    await db.attendance.insert_one(record.model_dump())
    return record


async def punch_out(employee_id: str) -> dict:
    date = today_iso()
    doc = await db.attendance.find_one({"employee_id": employee_id, "date": date})
    if not doc:
        raise HTTPException(status_code=404, detail="لا يوجد تسجيل حضور لهذا اليوم")
    if doc.get("check_out"):
        raise HTTPException(status_code=409, detail="تم تسجيل الانصراف مسبقاً")
    await db.attendance.update_one({"id": doc["id"]}, {"$set": {"check_out": now_time()}})
    return await db.attendance.find_one({"id": doc["id"]})