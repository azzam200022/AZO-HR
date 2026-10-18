from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.dates import aware
from lib.db import db
from models.hr import DeleteResult, LeaveCreate, LeaveRequest, LeaveUpdate

router = APIRouter(prefix="/leaves", tags=["leaves"], dependencies=[Depends(require_manager)])


def _to_model(doc: dict) -> LeaveRequest:
    doc["created_at"] = aware(doc.get("created_at"))
    return LeaveRequest(**doc)


@router.get("", response_model=list[LeaveRequest])
async def list_leaves(status: str | None = None, employee_id: str | None = None):
    query: dict = {}
    if status:
        query["status"] = status
    if employee_id:
        query["employee_id"] = employee_id
    docs = await db.leaves.find(query).sort("created_at", -1).to_list(1000)
    return [_to_model(d) for d in docs]


@router.post("", response_model=LeaveRequest, status_code=201)
async def create_leave(payload: LeaveCreate):
    employee = await db.employees.find_one({"id": payload.employee_id})
    if not employee:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له")
    leave = LeaveRequest(**payload.model_dump())
    await db.leaves.insert_one(leave.model_dump())
    return leave


@router.patch("/{leave_id}", response_model=LeaveRequest)
async def review_leave(leave_id: str, payload: LeaveUpdate):
    doc = await db.leaves.find_one({"id": leave_id})
    if not doc:
        raise HTTPException(status_code=404, detail="طلب الإجازة غير موجود")
    updates = payload.model_dump(exclude_none=True)
    if updates:
        await db.leaves.update_one({"id": leave_id}, {"$set": updates})
    fresh = await db.leaves.find_one({"id": leave_id})
    return _to_model(fresh)


@router.delete("/{leave_id}", response_model=DeleteResult)
async def delete_leave(leave_id: str):
    result = await db.leaves.delete_one({"id": leave_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="طلب الإجازة غير موجود")
    return DeleteResult(id=leave_id, deleted=True)