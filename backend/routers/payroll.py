from fastapi import APIRouter, HTTPException

from lib.dates import aware, current_month
from lib.db import db
from models.hr import GenerateResult, PayrollGenerate, PayrollItem, PayrollUpdate

router = APIRouter(prefix="/payroll", tags=["payroll"])


def _to_model(doc: dict) -> PayrollItem:
    doc["created_at"] = aware(doc.get("created_at"))
    return PayrollItem(**doc)


@router.get("", response_model=list[PayrollItem])
async def list_payroll(month: str | None = None, employee_id: str | None = None):
    query: dict = {"month": month or current_month()}
    if employee_id:
        query["employee_id"] = employee_id
    docs = await db.payroll.find(query).sort("net", -1).to_list(1000)
    return [_to_model(d) for d in docs]


@router.post("/generate", response_model=GenerateResult)
async def generate_payroll(payload: PayrollGenerate):
    """Create draft payroll items for every active employee missing one this month."""
    employees = await db.employees.find({"status": "active"}).to_list(1000)
    existing = await db.payroll.find({"month": payload.month}).to_list(1000)
    have = {d["employee_id"] for d in existing}
    fresh = [
        PayrollItem(
            employee_id=e["id"],
            month=payload.month,
            base_salary=e["base_salary"],
            allowances=e["allowances"],
            deductions=0,
            net=e["base_salary"] + e["allowances"],
        ).model_dump()
        for e in employees
        if e["id"] not in have
    ]
    if fresh:
        await db.payroll.insert_many(fresh)
    return GenerateResult(month=payload.month, created=len(fresh))


@router.patch("/{item_id}", response_model=PayrollItem)
async def update_payroll(item_id: str, payload: PayrollUpdate):
    doc = await db.payroll.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="بند المسير غير موجود")
    updates = payload.model_dump(exclude_none=True)
    if updates:
        merged = {**doc, **updates}
        net = merged["base_salary"] + merged["allowances"] - merged["deductions"]
        await db.payroll.update_one({"id": item_id}, {"$set": {**updates, "net": net}})
    fresh = await db.payroll.find_one({"id": item_id})
    return _to_model(fresh)