"""Employee self-service surface.

Every route here resolves the employee from the SESSION, never from a client-supplied id —
that is what makes cross-employee access (IDOR/BOLA) structurally impossible rather than
merely checked.
"""

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, require_employee
from lib.dates import aware, current_month
from lib.db import db
from lib.punch import punch_in, punch_out
from models.hr import (
    AttendanceRecord,
    Employee,
    LeaveRequest,
    PayrollItem,
    SelfLeaveCreate,
    SelfPunch,
    WorkLocation,
)

router = APIRouter(prefix="/me", tags=["self-service"])


async def _my_employee(principal: Principal) -> dict:
    doc = await db.employees.find_one({"id": principal.employee_id})
    if not doc:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return doc


@router.get("/profile", response_model=Employee)
async def my_profile(principal: Principal = Depends(require_employee)):
    doc = await _my_employee(principal)
    doc["created_at"] = aware(doc.get("created_at"))
    return Employee(**doc)


@router.get("/location", response_model=WorkLocation | None)
async def my_location(principal: Principal = Depends(require_employee)):
    doc = await _my_employee(principal)
    if not doc.get("location_id"):
        return None
    loc = await db.locations.find_one({"id": doc["location_id"]})
    if not loc:
        return None
    loc["created_at"] = aware(loc.get("created_at"))
    return WorkLocation(**loc)


@router.get("/attendance", response_model=list[AttendanceRecord])
async def my_attendance(principal: Principal = Depends(require_employee)):
    docs = (
        await db.attendance.find({"employee_id": principal.employee_id})
        .sort("date", -1)
        .to_list(500)
    )
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
    return [AttendanceRecord(**d) for d in docs]


@router.post("/check-in", response_model=AttendanceRecord)
async def my_check_in(payload: SelfPunch, principal: Principal = Depends(require_employee)):
    employee = await _my_employee(principal)
    return await punch_in(employee, payload.lat, payload.lng)


@router.post("/check-out", response_model=AttendanceRecord)
async def my_check_out(principal: Principal = Depends(require_employee)):
    doc = await punch_out(principal.employee_id)
    doc["created_at"] = aware(doc.get("created_at"))
    return AttendanceRecord(**doc)


@router.get("/leaves", response_model=list[LeaveRequest])
async def my_leaves(principal: Principal = Depends(require_employee)):
    docs = (
        await db.leaves.find({"employee_id": principal.employee_id})
        .sort("created_at", -1)
        .to_list(500)
    )
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
    return [LeaveRequest(**d) for d in docs]


@router.post("/leaves", response_model=LeaveRequest, status_code=201)
async def request_leave(payload: SelfLeaveCreate, principal: Principal = Depends(require_employee)):
    # The session decides whose leave this is — the body carries no employee_id at all.
    if payload.end_date < payload.start_date:
        raise HTTPException(
            status_code=400, detail="تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له"
        )
    leave = LeaveRequest(
        **{**payload.model_dump(), "employee_id": principal.employee_id},
    )
    await db.leaves.insert_one(leave.model_dump())
    return leave


@router.get("/payroll", response_model=list[PayrollItem])
async def my_payroll(month: str | None = None, principal: Principal = Depends(require_employee)):
    docs = await db.payroll.find(
        {"employee_id": principal.employee_id, "month": month or current_month()}
    ).to_list(100)
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
    return [PayrollItem(**d) for d in docs]