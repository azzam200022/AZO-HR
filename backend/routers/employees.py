from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from lib.cycle import CyclePeriod

from lib.auth import Principal, hash_password, new_access_code, require_manager
from lib.dates import aware
from lib.db import db
from lib.employee_photo import employee_photo_response
from lib.reports import build_report
from models.auth import AccessCodeResult, SetPasswordPayload
from models.hr import DeleteResult, Employee, EmployeeCreate, EmployeeReport, EmployeeUpdate

# Every route in this router is manager-only.
router = APIRouter(prefix="/employees", tags=["employees"], dependencies=[Depends(require_manager)])


async def _get_employee_or_404(employee_id: str) -> dict:
    doc = await db.employees.find_one({"id": employee_id})
    if not doc:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return doc


def _to_model(doc: dict) -> Employee:
    doc["created_at"] = aware(doc.get("created_at"))
    doc["has_photo"] = bool(doc.get("photo_data"))
    return Employee(**doc)


@router.get("", response_model=list[Employee])
async def list_employees(status: str | None = None):
    query = {"status": status} if status else {}
    docs = await db.employees.find(query).sort("created_at", -1).to_list(1000)
    return [_to_model(d) for d in docs]


@router.get("/{employee_id}", response_model=Employee)
async def get_employee(employee_id: str):
    doc = await _get_employee_or_404(employee_id)
    return _to_model(doc)


@router.get("/{employee_id}/photo", response_class=Response)
async def get_employee_photo(employee_id: str):
    return employee_photo_response(await _get_employee_or_404(employee_id))


@router.post("", response_model=Employee, status_code=201)
async def create_employee(payload: EmployeeCreate):
    """Create an employee with a login code and, optionally, email/password access."""
    if payload.password and not payload.email.strip():
        raise HTTPException(status_code=400, detail="أضف بريداً إلكترونياً للموظف أولاً")
    employee_data = payload.model_dump(exclude={"photo_data", "password"})
    employee = Employee(**employee_data)
    while await db.employees.find_one({"access_code": employee.access_code or "x"}):
        employee.access_code = new_access_code()
    if not employee.access_code:
        employee.access_code = new_access_code()
        while await db.employees.find_one({"access_code": employee.access_code}):
            employee.access_code = new_access_code()
    employee_doc = employee.model_dump()
    employee_doc["photo_data"] = payload.photo_data
    if payload.password:
        employee_doc["password_hash"] = hash_password(payload.password)
    await db.employees.insert_one(employee_doc)
    return _to_model(employee_doc)


@router.get("/{employee_id}/report", response_model=EmployeeReport)
async def employee_report(
    employee_id: str,
    month: str | None = None,
    cycle: CyclePeriod | None = None,
):
    """Same report the employee sees in their own profile."""
    if month is not None and cycle is not None:
        raise HTTPException(status_code=400, detail="اختر دورة أو شهرًا واحدًا للتقرير")
    return await build_report(await _get_employee_or_404(employee_id), month, cycle)


@router.post("/{employee_id}/regenerate-code", response_model=AccessCodeResult)
async def regenerate_code(employee_id: str):
    await _get_employee_or_404(employee_id)
    code = new_access_code()
    while await db.employees.find_one({"access_code": code}):
        code = new_access_code()
    await db.employees.update_one({"id": employee_id}, {"$set": {"access_code": code}})
    # Existing sessions for this employee are revoked — a reissued code ends the old login.
    await db.sessions.delete_many({"employee_id": employee_id})
    return AccessCodeResult(employee_id=employee_id, access_code=code)


@router.post("/{employee_id}/set-password", response_model=AccessCodeResult)
async def set_employee_password(employee_id: str, payload: SetPasswordPayload):
    """Optional: let an employee also sign in with their email + a password."""
    employee = await _get_employee_or_404(employee_id)
    if not employee.get("email"):
        raise HTTPException(status_code=400, detail="أضف بريداً إلكترونياً للموظف أولاً")
    await db.employees.update_one(
        {"id": employee_id}, {"$set": {"password_hash": hash_password(payload.password)}}
    )
    return AccessCodeResult(employee_id=employee_id, access_code=employee.get("access_code", ""))


@router.put("/{employee_id}", response_model=Employee)
async def update_employee(employee_id: str, payload: EmployeeUpdate):
    updates = payload.model_dump(exclude_none=True)
    if updates:
        result = await db.employees.update_one({"id": employee_id}, {"$set": updates})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="الموظف غير موجود")
    doc = await _get_employee_or_404(employee_id)
    return _to_model(doc)


@router.delete("/{employee_id}", response_model=DeleteResult)
async def delete_employee(employee_id: str):
    await _get_employee_or_404(employee_id)
    await db.employees.delete_one({"id": employee_id})
    await db.attendance.delete_many({"employee_id": employee_id})
    await db.leaves.delete_many({"employee_id": employee_id})
    await db.payroll.delete_many({"employee_id": employee_id})
    await db.sessions.delete_many({"employee_id": employee_id})
    return DeleteResult(id=employee_id, deleted=True)