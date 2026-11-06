from fastapi import APIRouter, Depends

from lib.auth import require_manager
from lib.dates import aware, current_month, now_time, now_utc, past_days, today_iso
from lib.db import db
from models.hr import DashboardStats, LeaveWithEmployee, TodayResponse, TrendPoint

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardStats, dependencies=[Depends(require_manager)])
async def dashboard():
    today = today_iso()
    month = current_month()

    total_employees = await db.employees.count_documents({})
    active_employees = await db.employees.count_documents({"status": "active"})
    present_today = await db.attendance.count_documents({"date": today})
    pending_leaves = await db.leaves.count_documents({"status": "pending"})

    items = await db.payroll.find({"month": month}).to_list(1000)
    payroll_total = sum(i.get("net", 0) for i in items)

    trend_dates = past_days(7)
    trend_docs = await db.attendance.find({"date": {"$in": trend_dates}}).to_list(1000)
    counts: dict[str, int] = {d: 0 for d in trend_dates}
    for doc in trend_docs:
        counts[doc["date"]] = counts.get(doc["date"], 0) + 1
    trend = [TrendPoint(date=d, present=counts[d]) for d in trend_dates]

    leave_docs = await db.leaves.find({}, {"status": 1}).to_list(1000)
    breakdown = {"pending": 0, "approved": 0, "rejected": 0}
    for doc in leave_docs:
        status = doc.get("status")
        if status in breakdown:
            breakdown[status] += 1

    recent_docs = await db.leaves.find().sort("created_at", -1).to_list(5)
    employees = await db.employees.find({}, {"id": 1, "name": 1}).to_list(1000)
    names = {e["id"]: e["name"] for e in employees}
    recent = []
    for doc in recent_docs:
        doc["created_at"] = aware(doc.get("created_at"))
        recent.append(LeaveWithEmployee(**doc, employee_name=names.get(doc["employee_id"], "—")))

    return DashboardStats(
        total_employees=total_employees,
        active_employees=active_employees,
        present_today=present_today,
        pending_leaves=pending_leaves,
        payroll_month=month,
        payroll_total=payroll_total,
        attendance_trend=trend,
        leave_breakdown=breakdown,
        recent_leaves=recent,
    )


@router.get("/today", response_model=TodayResponse)
async def today():
    return TodayResponse(today=today_iso(), now_hhmm=now_time(), now_utc=now_utc())