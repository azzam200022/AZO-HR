"""Manual bonuses and deductions, each one requiring a stated reason."""

from __future__ import annotations

from typing import TYPE_CHECKING

from lib.cycle import pay_cycle
from lib.dates import aware, today_iso

if TYPE_CHECKING:
    from models.hr import Adjustment


def cycle_adjustment_query(
    employee_id: str | None,
    start: str,
    end: str,
) -> dict:
    """Match saved cycle assignments and include legacy, unassigned adjustments by date."""
    query: dict = {
        "$or": [
            {"cycle_start": start},
            {
                "cycle_start": {"$in": ["", None]},
                "date": {"$gte": start, "$lte": end},
            },
        ]
    }
    if employee_id:
        query["employee_id"] = employee_id
    return query


def to_model(doc: dict) -> Adjustment:
    from models.hr import Adjustment

    doc["created_at"] = aware(doc.get("created_at"))
    return Adjustment(**doc)


async def cycle_adjustments(employee: dict, start: str, end: str) -> list[dict]:
    """Fetch adjustments assigned to a cycle, falling back to dates for legacy records."""
    from lib.db import db

    return await db.adjustments.find(
        cycle_adjustment_query(employee["id"], start, end)
    ).to_list(500)


async def adjustment_totals(employee: dict, start: str, end: str) -> tuple[float, float]:
    """(bonus_total, deduction_total) for the cycle."""
    docs = await cycle_adjustments(employee, start, end)
    bonus = sum(float(d["amount"]) for d in docs if d.get("kind") == "bonus")
    deduction = sum(float(d["amount"]) for d in docs if d.get("kind") == "deduction")
    return round(bonus, 2), round(deduction, 2)


async def current_cycle_of(employee: dict) -> tuple[str, str]:
    return pay_cycle(employee, today_iso())
