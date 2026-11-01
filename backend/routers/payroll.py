from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.dates import aware, current_month
from lib.db import db
from lib.payroll_rules import late_summary, net_of
from models.hr import GenerateResult, PayrollGenerate, PayrollItem, PayrollUpdate

router = APIRouter(prefix="/payroll", tags=["payroll"], dependencies=[Depends(require_manager)])


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
    """Create draft items for employees missing one, and refresh the late deduction on all.

    The lateness deduction is always recomputed from attendance, so regenerating after new
    punches keeps the month's payroll honest.
    """
    employees = await db.employees.find({"status": "active"}).to_list(1000)
    existing = await db.payroll.find({"month": payload.month}).to_list(1000)
    have = {d["employee_id"]: d for d in existing}

    created = 0
    updated = 0
    for emp in employees:
        late, away, deduction = await late_summary(emp, payload.month)
        current = have.get(emp["id"])
        if current is None:
            item = PayrollItem(
                employee_id=emp["id"],
                month=payload.month,
                base_salary=emp["base_salary"],
                allowances=emp["allowances"],
                deductions=0,
                late_minutes=late,
                away_minutes=away,
                late_deduction=deduction,
            )
            fresh = item.model_dump()
            fresh["net"] = net_of(fresh)
            await db.payroll.insert_one(fresh)
            created += 1
            continue
        if current.get("status") == "paid":
            continue  # a paid payslip is settled — never rewrite it
        merged = {**current, "late_minutes": late, "away_minutes": away, "late_deduction": deduction}
        await db.payroll.update_one(
            {"id": current["id"]},
            {
                "$set": {
                    "late_minutes": late,
                    "away_minutes": away,
                    "late_deduction": deduction,
                    "net": net_of(merged),
                }
            },
        )
        updated += 1

    return GenerateResult(month=payload.month, created=created, updated=updated)


@router.patch("/{item_id}", response_model=PayrollItem)
async def update_payroll(item_id: str, payload: PayrollUpdate):
    doc = await db.payroll.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="بند المسير غير موجود")
    updates = payload.model_dump(exclude_none=True)
    if updates:
        merged = {**doc, **updates}
        await db.payroll.update_one({"id": item_id}, {"$set": {**updates, "net": net_of(merged)}})
    fresh = await db.payroll.find_one({"id": item_id})
    return _to_model(fresh)
