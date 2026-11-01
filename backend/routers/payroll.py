from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.cycle import cycle_label, pay_cycle
from lib.dates import aware, current_month, today_iso
from lib.db import db
from lib.payroll_rules import cycle_figures, net_of, settle_cycle
from models.hr import GenerateResult, PayrollGenerate, PayrollItem, PayrollUpdate

router = APIRouter(prefix="/payroll", tags=["payroll"], dependencies=[Depends(require_manager)])


def _to_model(doc: dict) -> PayrollItem:
    doc["created_at"] = aware(doc.get("created_at"))
    return PayrollItem(**doc)


def _reference_date(month: str) -> str:
    """A date inside the requested month, used to locate each employee's own cycle."""
    today = today_iso()
    return today if today.startswith(month) else f"{month}-15"


@router.get("", response_model=list[PayrollItem])
async def list_payroll(month: str | None = None, employee_id: str | None = None):
    """Payslips covering the cycle each employee is in during `month`.

    Items are keyed by their own cycle label, so filtering by the calendar month directly
    would hide exactly the payslip the manager is looking at.
    """
    month = month or current_month()
    reference = _reference_date(month)
    emp_query: dict = {"id": employee_id} if employee_id else {}
    employees = await db.employees.find(emp_query).to_list(1000)

    docs: list[dict] = []
    for emp in employees:
        start, _end = pay_cycle(emp, reference)
        # Matched on the exact cycle start: labels alone would collide with legacy
        # calendar-month items and hide the payslip being worked on.
        doc = await db.payroll.find_one({"employee_id": emp["id"], "cycle_start": start})
        if doc:
            docs.append(doc)
    docs.sort(key=lambda d: d.get("net", 0), reverse=True)
    return [_to_model(d) for d in docs]


@router.post("/generate", response_model=GenerateResult)
async def generate_payroll(payload: PayrollGenerate):
    """Create/refresh one payslip per employee for THEIR cycle inside the requested month.

    Figures (lateness, away time, bonuses, deductions) are always recomputed from the
    cycle's own records; a paid payslip is settled and never rewritten.
    """
    reference = _reference_date(payload.month)
    employees = await db.employees.find({"status": "active"}).to_list(1000)
    created = 0
    updated = 0

    for emp in employees:
        figures = await cycle_figures(emp, reference)
        label = cycle_label(figures["cycle_start"])
        current = await db.payroll.find_one(
            {"employee_id": emp["id"], "cycle_start": figures["cycle_start"]}
        )

        if current is None:
            item = PayrollItem(
                employee_id=emp["id"],
                month=label,
                base_salary=emp["base_salary"],
                allowances=emp["allowances"],
                deductions=0,
                **figures,
            )
            fresh = item.model_dump()
            fresh["net"] = net_of(fresh)
            await db.payroll.insert_one(fresh)
            created += 1
            continue

        if current.get("status") == "paid":
            continue
        merged = {**current, **figures}
        await db.payroll.update_one(
            {"id": current["id"]}, {"$set": {**figures, "net": net_of(merged)}}
        )
        updated += 1

    return GenerateResult(month=payload.month, created=created, updated=updated)


@router.patch("/{item_id}", response_model=PayrollItem)
async def update_payroll(item_id: str, payload: PayrollUpdate):
    doc = await db.payroll.find_one({"id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="بند المسير غير موجود")
    if doc.get("status") == "paid" and payload.status != "draft":
        raise HTTPException(status_code=409, detail="هذا الراتب مدفوع وتمت تسوية دورته")

    updates = payload.model_dump(exclude_none=True)
    if updates:
        merged = {**doc, **updates}
        updates["net"] = net_of(merged)
        archived = 0
        if updates.get("status") == "paid":
            # Paying the salary settles the cycle: its attendance leaves the running record.
            archived = await settle_cycle({**doc, **updates})
            updates["archived_days"] = archived
        await db.payroll.update_one({"id": item_id}, {"$set": updates})

    fresh = await db.payroll.find_one({"id": item_id})
    return _to_model(fresh)


@router.get("/cycle/{employee_id}", response_model=dict)
async def employee_cycle(employee_id: str):
    """Current open cycle of one employee — used by the manager UI."""
    emp = await db.employees.find_one({"id": employee_id})
    if not emp:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    start, end = pay_cycle(emp, today_iso())
    return {"cycle_start": start, "cycle_end": end, "label": cycle_label(start)}
