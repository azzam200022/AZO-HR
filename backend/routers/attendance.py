from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.attendance_calendar import daily_attendance_records
from lib.dates import aware, now_time, today_iso
from lib.db import db
from lib.geo import haversine_m
from lib.notify import notify_employee_event
from lib.punch import punch_in, punch_out
from lib.shift import effective_away_minutes, employee_shift, is_working_day, late_minutes
from models.hr import (
    AttendanceCreate,
    AttendanceRecord,
    AttendanceUpdate,
    CheckPunch,
    DeleteResult,
)

router = APIRouter(
    prefix="/attendance", tags=["attendance"], dependencies=[Depends(require_manager)]
)


def _to_model(
    doc: dict, employee: dict | None = None, *, today: str | None = None, now: str | None = None
) -> AttendanceRecord:
    record = dict(doc)
    record["created_at"] = aware(record.get("created_at"))
    if employee and (record.get("status") or "present") == "present":
        start, end, grace = employee_shift(employee)
        work_days = employee.get("work_days")
        record["late_minutes"] = late_minutes(
            record.get("check_in", ""), start, grace,
            work_date=record.get("date"), work_days=work_days,
        )
        if not is_working_day(record.get("date", ""), work_days):
            record["away_minutes"] = 0
        else:
            record["away_minutes"] = effective_away_minutes(
                record, now or now_time(), today or today_iso(), start, end
            )
    return AttendanceRecord(**record)


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
    live_docs = await db.attendance.find(query).to_list(1000)
    archive_docs = await db.attendance_archive.find(query).to_list(1000)
    for doc in archive_docs:
        doc["is_archived"] = True
    by_id = {doc["id"]: doc for doc in archive_docs}
    by_id.update({doc["id"]: doc for doc in live_docs})
    docs = list(by_id.values())

    employees = await db.employees.find().to_list(1000)
    employee_by_id = {employee["id"]: employee for employee in employees}
    today = today_iso()
    now = now_time()
    records = [
        _to_model(doc, employee_by_id.get(doc.get("employee_id")), today=today, now=now)
        for doc in docs
    ]

    if date:
        scheduled_employees = [
            employee
            for employee in employees
            if employee.get("status", "active") == "active"
            and (not employee_id or employee.get("id") == employee_id)
        ]
        scheduled_ids = [employee["id"] for employee in scheduled_employees]
        leave_docs = []
        if scheduled_ids:
            leave_docs = await db.leaves.find(
                {
                    "employee_id": {"$in": scheduled_ids},
                    "status": "approved",
                    "start_date": {"$lte": date},
                    "end_date": {"$gte": date},
                }
            ).to_list(1000)
        leaves_by_employee: dict[str, list[dict]] = {}
        for leave in leave_docs:
            leaves_by_employee.setdefault(leave["employee_id"], []).append(leave)
        actual_by_employee: dict[str, list[dict]] = {}
        for doc in docs:
            actual_by_employee.setdefault(doc.get("employee_id", ""), []).append(doc)
        for employee in scheduled_employees:
            if actual_by_employee.get(employee["id"]):
                continue
            records.extend(
                daily_attendance_records(
                    employee,
                    date,
                    date,
                    [],
                    leaves_by_employee.get(employee["id"], []),
                    today=today,
                    now=now,
                )
            )
    return sorted(records, key=lambda record: (record.date, record.check_in), reverse=True)


@router.post("", response_model=AttendanceRecord, status_code=201)
async def create_attendance(payload: AttendanceCreate):
    """Manual record entry by the manager."""
    employee = await _get_employee_or_404(payload.employee_id)
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
    await notify_employee_event(
        kind="attendance",
        employee=employee,
        date=date,
        message=(
            f"أضافت الإدارة سجل حضورك ليوم {date}: "
            f"الحضور {record.check_in or '—'}، الانصراف {record.check_out or '—'}."
        ),
    )
    return record


@router.post("/check-in", response_model=AttendanceRecord)
async def check_in(payload: CheckPunch):
    """Manager punching a employee in on their behalf (same geofence rules)."""
    employee = await _get_employee_or_404(payload.employee_id)
    record = await punch_in(employee, payload.lat, payload.lng, notify_manager=False)
    await notify_employee_event(
        kind="attendance",
        employee=employee,
        date=record.date,
        message=f"سجّلت الإدارة حضورك الساعة {record.check_in}.",
    )
    return record


@router.post("/check-out", response_model=AttendanceRecord)
async def check_out(payload: CheckPunch):
    employee = await _get_employee_or_404(payload.employee_id)
    doc = await punch_out(payload.employee_id, notify_manager=False)
    await notify_employee_event(
        kind="attendance",
        employee=employee,
        date=doc.get("date", today_iso()),
        message=f"سجّلت الإدارة انصرافك الساعة {doc.get('check_out', '')}.",
    )
    return _to_model(doc)


@router.patch("/{record_id}", response_model=AttendanceRecord)
async def update_attendance(record_id: str, payload: AttendanceUpdate):
    doc = await db.attendance.find_one({"id": record_id})
    if not doc:
        raise HTTPException(status_code=404, detail="سجل الحضور غير موجود")
    updates = payload.model_dump(exclude_none=True)
    if updates:
        await db.attendance.update_one({"id": record_id}, {"$set": updates})
    fresh = await db.attendance.find_one({"id": record_id})
    if updates:
        employee = await _get_employee_or_404(doc["employee_id"])
        detail = "، ".join(
            part
            for field, label in (("check_in", "الحضور"), ("check_out", "الانصراف"))
            if field in updates
            for part in [f"{label} {fresh.get(field, '') or '—'}"]
        )
        suffix = f" ({detail})" if detail else ""
        await notify_employee_event(
            kind="attendance",
            employee=employee,
            date=fresh.get("date", today_iso()),
            message=f"عدّلت الإدارة سجل حضورك ليوم {fresh.get('date', '')}{suffix}.",
        )
    return _to_model(fresh)


@router.delete("/{record_id}", response_model=DeleteResult)
async def delete_attendance(record_id: str):
    result = await db.attendance.delete_one({"id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="سجل الحضور غير موجود")
    return DeleteResult(id=record_id, deleted=True)