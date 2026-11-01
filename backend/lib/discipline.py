"""Monthly punctuality ranking for the manager console."""

from lib.cycle import pay_cycle
from lib.dates import today_iso
from lib.db import db
from lib.payroll_rules import cycle_attendance, late_summary
from lib.shift import employee_shift, late_minutes
from models.hr import DisciplineReport, DisciplineRow


def _score(days: int, late_days: int, late_total: int) -> int:
    """0-100 punctuality score: 70% how often on time, 30% how mild the lateness is.

    Split on purpose — a single two-minute slip must not read the same as chronic lateness.
    """
    if days == 0:
        return 0  # no attendance at all: reported as "—" and ranked last
    on_time_ratio = (days - late_days) / days
    avg_late = late_total / days
    severity = max(0.0, 1 - avg_late / 60)  # an hour average wipes out this half
    return max(0, round(70 * on_time_ratio + 30 * severity))


async def build_discipline_report(month: str) -> DisciplineReport:
    employees = await db.employees.find({"status": "active"}).sort("name", 1).to_list(1000)
    rows: list[DisciplineRow] = []
    reference = today_iso() if today_iso().startswith(month) else f"{month}-15"

    for emp in employees:
        shift_start, shift_end, grace = employee_shift(emp)
        cycle_start, cycle_end = pay_cycle(emp, reference)
        docs = await cycle_attendance(emp["id"], cycle_start, cycle_end)
        days = len(docs)
        per_day_late = [late_minutes(d.get("check_in", ""), shift_start, grace) for d in docs]
        late_days = sum(1 for m in per_day_late if m > 0)
        total_late = sum(per_day_late)
        _l, total_away, deduction = await late_summary(emp, reference)

        rows.append(
            DisciplineRow(
                employee_id=emp["id"],
                name=emp.get("name", ""),
                job_title=emp.get("job_title", ""),
                shift_start=shift_start,
                shift_end=shift_end,
                cycle_start=cycle_start,
                cycle_end=cycle_end,
                days_present=days,
                late_days=late_days,
                on_time_days=days - late_days,
                late_minutes=total_late,
                away_minutes=total_away,
                total_late_minutes=total_late + total_away,
                avg_late_minutes=round(total_late / days) if days else 0,
                deduction=deduction,
                score=_score(days, late_days, total_late + total_away),
                rank=0,
            )
        )

    # Best discipline first. Employees with no attendance this month have nothing to judge,
    # so they sink to the bottom instead of topping the list with an empty record.
    rows.sort(
        key=lambda r: (r.days_present == 0, -r.score, r.total_late_minutes, -r.days_present)
    )
    for index, row in enumerate(rows, start=1):
        row.rank = index

    return DisciplineReport(
        month=month,
        rows=rows,
        employees=len(rows),
        total_late_minutes=sum(r.total_late_minutes for r in rows),
        total_deduction=round(sum(r.deduction for r in rows), 2),
    )
