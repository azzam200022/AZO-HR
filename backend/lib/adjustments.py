"""Manual bonuses and deductions, each one requiring a stated reason."""

from lib.cycle import pay_cycle
from lib.dates import aware, today_iso
from lib.db import db
from models.hr import Adjustment


def to_model(doc: dict) -> Adjustment:
    doc["created_at"] = aware(doc.get("created_at"))
    return Adjustment(**doc)


async def cycle_adjustments(employee: dict, start: str, end: str) -> list[dict]:
    """Adjustments dated inside the cycle, settled ones excluded from re-use."""
    return await db.adjustments.find(
        {"employee_id": employee["id"], "date": {"$gte": start, "$lte": end}}
    ).to_list(500)


async def adjustment_totals(employee: dict, start: str, end: str) -> tuple[float, float]:
    """(bonus_total, deduction_total) for the cycle."""
    docs = await cycle_adjustments(employee, start, end)
    bonus = sum(float(d["amount"]) for d in docs if d.get("kind") == "bonus")
    deduction = sum(float(d["amount"]) for d in docs if d.get("kind") == "deduction")
    return round(bonus, 2), round(deduction, 2)


async def current_cycle_of(employee: dict) -> tuple[str, str]:
    return pay_cycle(employee, today_iso())
