from fastapi import APIRouter, Depends, HTTPException

from lib.adjustments import to_model
from lib.auth import require_manager
from lib.cycle import pay_cycle
from lib.dates import today_iso
from lib.db import db
from models.hr import Adjustment, AdjustmentCreate, DeleteResult

router = APIRouter(
    prefix="/adjustments", tags=["adjustments"], dependencies=[Depends(require_manager)]
)


@router.get("", response_model=list[Adjustment])
async def list_adjustments(employee_id: str | None = None, month: str | None = None):
    query: dict = {}
    if employee_id:
        query["employee_id"] = employee_id
    if month:
        query["date"] = {"$regex": f"^{month}"}
    docs = await db.adjustments.find(query).sort("date", -1).to_list(1000)
    return [to_model(d) for d in docs]


@router.post("", response_model=Adjustment, status_code=201)
async def create_adjustment(payload: AdjustmentCreate):
    """A bonus or deduction — the reason is mandatory and travels with the payslip."""
    employee = await db.employees.find_one({"id": payload.employee_id})
    if not employee:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="سبب الخصم أو الحافز مطلوب")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="المبلغ يجب أن يكون أكبر من صفر")

    date = payload.date or today_iso()
    start, end = pay_cycle(employee, date)
    item = Adjustment(
        employee_id=payload.employee_id,
        employee_name=employee.get("name", ""),
        kind=payload.kind,
        amount=payload.amount,
        reason=payload.reason.strip(),
        date=date,
        cycle_start=start,
        cycle_end=end,
    )
    await db.adjustments.insert_one(item.model_dump())
    return item


@router.delete("/{item_id}", response_model=DeleteResult)
async def delete_adjustment(item_id: str):
    doc = await db.adjustments.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="البند غير موجود")
    if doc.get("settled"):
        raise HTTPException(status_code=409, detail="لا يمكن حذف بند تمت تسويته مع راتب مدفوع")
    await db.adjustments.delete_one({"id": item_id})
    return DeleteResult(id=item_id, deleted=True)
