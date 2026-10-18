from fastapi import APIRouter, HTTPException

from lib.dates import aware, now_time, today_iso
from lib.db import db
from lib.geo import haversine_m
from models.hr import (
    AttendanceCreate,
    AttendanceRecord,
    AttendanceUpdate,
    CheckPunch,
    DeleteResult,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _to_model(doc: dict) -> AttendanceRecord:
    doc["created_at"] = aware(doc.get("created_at"))
    return AttendanceRecord(**doc)


async def _get_employee_or_404(employee_id: str) -> dict:
    doc = await db.employees.find_one({"id": employee_id})
    if not doc:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return doc


@router.get("", response_model=list[AttendanceRecord])
async def list_attendance(date: str | None = None, employee_id: str | None = None):
    query: dict = {}
    if date:
        query["date"] = date
    if employee_id:
        query["employee_id"] = employee_id
    docs = await db.attendance.find(query).sort([("date", -1), ("check_in", -1)]).to_list(1000)
    return [_to_model(d) for d in docs]


@router.post("", response_model=AttendanceRecord, status_code=201)
async def create_attendance(payload: AttendanceCreate):
    """Manual record entry by the manager."""
    await _get_employee_or_404(payload.employee_id)
    date = payload.date or today_iso()
    existing = await db.attendance.find_one({"employee_id": payload.employee_id, "date": date})
    if existing:
        raise HTTPException(status_code=409, detail="يوجد سجل حضور لهذا الموظف في نفس التاريخ")
    record = AttendanceRecord(
        employee_id=payload.employee_id,
        date=date,
        check_in=payload.check_in,
        check_out=payload.check_out,
    )
    await db.attendance.insert_one(record.model_dump())
    return record


@router.post("/check-in", response_model=AttendanceRecord)
async def check_in(payload: CheckPunch):
    employee = await _get_employee_or_404(payload.employee_id)

    # Geofence: an employee may punch in only inside the work location the manager assigned.
    location_id = employee.get("location_id") or ""
    location_doc = await db.locations.find_one({"id": location_id}) if location_id else None
    distance: float | None = None
    if location_doc:
        if payload.lat is None or payload.lng is None:
            raise HTTPException(
                status_code=400,
                detail="تسجيل الحضور يتطلب تحديد موقعك الجغرافي — فعّل صلاحية الموقع في المتصفح",
            )
        distance = haversine_m(payload.lat, payload.lng, location_doc["latitude"], location_doc["longitude"])
        allowed = location_doc.get("radius_m", 150)
        if distance > allowed:
            raise HTTPException(
                status_code=403,
                detail=f"أنت خارج نطاق موقع العمل «{location_doc['name']}» — الحضور مسموح فقط ضمن {allowed} متراً منه",
            )

    date = today_iso()
    existing = await db.attendance.find_one({"employee_id": payload.employee_id, "date": date})
    if existing:
        raise HTTPException(status_code=409, detail="تم تسجيل الحضور مسبقاً لهذا اليوم")
    record = AttendanceRecord(
        employee_id=payload.employee_id,
        date=date,
        check_in=now_time(),
        location_id=location_doc["id"] if location_doc else "",
        distance_m=round(distance, 1) if distance is not None else None,
    )
    await db.attendance.insert_one(record.model_dump())
    return record


@router.post("/check-out", response_model=AttendanceRecord)
async def check_out(payload: CheckPunch):
    date = today_iso()
    doc = await db.attendance.find_one({"employee_id": payload.employee_id, "date": date})
    if not doc:
        raise HTTPException(status_code=404, detail="لا يوجد تسجيل حضور لهذا اليوم")
    if doc.get("check_out"):
        raise HTTPException(status_code=409, detail="تم تسجيل الانصراف مسبقاً")
    await db.attendance.update_one({"id": doc["id"]}, {"$set": {"check_out": now_time()}})
    fresh = await db.attendance.find_one({"id": doc["id"]})
    return _to_model(fresh)


@router.patch("/{record_id}", response_model=AttendanceRecord)
async def update_attendance(record_id: str, payload: AttendanceUpdate):
    doc = await db.attendance.find_one({"id": record_id})
    if not doc:
        raise HTTPException(status_code=404, detail="سجل الحضور غير موجود")
    updates = payload.model_dump(exclude_none=True)
    if updates:
        await db.attendance.update_one({"id": record_id}, {"$set": updates})
    fresh = await db.attendance.find_one({"id": record_id})
    return _to_model(fresh)


@router.delete("/{record_id}", response_model=DeleteResult)
async def delete_attendance(record_id: str):
    result = await db.attendance.delete_one({"id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="سجل الحضور غير موجود")
    return DeleteResult(id=record_id, deleted=True)