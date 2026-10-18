"""Idempotent demo seed for the HR app. Run: cd /app/backend && python seed.py"""

import asyncio
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from lib.auth import hash_password, new_access_code
from lib.db import db, ensure_indexes
from lib.dates import current_month, today_iso
from models.hr import AttendanceRecord, Employee, LeaveRequest, PayrollItem, WorkLocation

APP_TZ = ZoneInfo("Asia/Riyadh")

LOCATIONS = [
    {"id": "loc-1", "name": "المقر الرئيسي — طريق الملك فهد", "latitude": 24.7136, "longitude": 46.6753, "radius_m": 250},
    {"id": "loc-2", "name": "فرع العليا", "latitude": 24.6941, "longitude": 46.6834, "radius_m": 150},
]

LOCATION_ASSIGN = {
    "emp-1": "loc-1",
    "emp-2": "loc-1",
    "emp-3": "loc-1",
    "emp-4": "loc-2",
    "emp-5": "loc-2",
}

EMPLOYEES = [
    {"id": "emp-1", "name": "أحمد المنصوري", "job_title": "مدير العمليات والتقنية", "email": "ahmed@mawaridi.sa", "phone": "0501234567", "base_salary": 18500, "allowances": 3500, "hire_date": "2022-01-15", "status": "active"},
    {"id": "emp-2", "name": "سارة القحطاني", "job_title": "أخصائية موارد بشرية", "email": "sara@mawaridi.sa", "phone": "0559876543", "base_salary": 12000, "allowances": 2000, "hire_date": "2023-03-01", "status": "active"},
    {"id": "emp-3", "name": "فيصل العتيبي", "job_title": "مطور برمجيات أول", "email": "faisal@mawaridi.sa", "phone": "0543219876", "base_salary": 16000, "allowances": 2500, "hire_date": "2022-06-10", "status": "active"},
    {"id": "emp-4", "name": "نورة الشمري", "job_title": "محاسبة مالية", "email": "noura@mawaridi.sa", "phone": "0567891234", "base_salary": 13500, "allowances": 2000, "hire_date": "2021-11-20", "status": "active"},
    {"id": "emp-5", "name": "خالد الغامدي", "job_title": "مسؤول تسويق رقمي", "email": "khaled@mawaridi.sa", "phone": "0534567890", "base_salary": 11000, "allowances": 1500, "hire_date": "2023-08-15", "status": "active"},
]

CHECK_SCHEDULE = {
    "emp-1": ("08:35", "17:05"),
    "emp-2": ("08:52", "17:30"),
    "emp-3": ("09:10", "17:45"),
    "emp-4": ("08:45", "17:15"),
    "emp-5": ("09:00", "18:00"),
}


def _shift(days: int) -> str:
    return (datetime.now(APP_TZ) + timedelta(days=days)).strftime("%Y-%m-%d")


def _is_workday(day: str) -> bool:
    # Friday(4) / Saturday(5) weekend
    return datetime.strptime(day, "%Y-%m-%d").weekday() not in (4, 5)


async def main() -> None:
    await ensure_indexes()

    # Manager account — the only principal allowed into the management console.
    email = (os.environ.get("MANAGER_EMAIL") or "").strip().lower()
    password = os.environ.get("MANAGER_PASSWORD") or ""
    if email and password:
        await db.users.update_one(
            {"email": email},
            {
                "$set": {"role": "manager", "password_hash": hash_password(password)},
                "$setOnInsert": {"created_at": datetime.now(APP_TZ)},
            },
            upsert=True,
        )
        # Any other manager rows are stale — only the configured email may be manager.
        await db.users.delete_many({"role": "manager", "email": {"$ne": email}})
        print(f"manager account ready: {email}")

    # Issue a login code to any employee missing one.
    for doc in await db.employees.find({"access_code": {"$in": ["", None]}}).to_list(1000):
        code = new_access_code()
        while await db.employees.find_one({"access_code": code}):
            code = new_access_code()
        await db.employees.update_one(
            {"id": doc["id"]}, {"$set": {"access_code": code, "can_login": True}}
        )
        print(f"  code for {doc['name']}: {code}")

    if await db.locations.count_documents({}) == 0:
        await db.locations.insert_many([WorkLocation(**l).model_dump() for l in LOCATIONS])
        print(f"seeded {len(LOCATIONS)} work locations")

    # Bind any employee without an assigned work location (demo default: المقر الرئيسي)
    unassigned = await db.employees.find({"location_id": {"$in": ["", None]}}).to_list(1000)
    for e in unassigned:
        await db.employees.update_one(
            {"id": e["id"]},
            {"$set": {"location_id": LOCATION_ASSIGN.get(e["id"], "loc-1")}},
        )
    if unassigned:
        print(f"assigned work locations to {len(unassigned)} employees")

    if await db.employees.count_documents({}) == 0:
        await db.employees.insert_many([Employee(**e).model_dump() for e in EMPLOYEES])
        print(f"seeded {len(EMPLOYEES)} employees")

    if await db.attendance.count_documents({}) == 0:
        today = today_iso()
        records = []
        for offset in range(0, 8):
            day = _shift(-offset)
            if not _is_workday(day):
                continue
            for emp_id, (check_in, check_out) in CHECK_SCHEDULE.items():
                if day == today and emp_id in ("emp-3", "emp-4", "emp-5"):
                    continue  # haven't punched in yet today
                records.append(
                    AttendanceRecord(
                        employee_id=emp_id,
                        date=day,
                        check_in=check_in,
                        check_out="" if (day == today and emp_id == "emp-1") else check_out,
                    ).model_dump()
                )
        if records:
            await db.attendance.insert_many(records)
        print(f"seeded {len(records)} attendance records")

    if await db.leaves.count_documents({}) == 0:
        leaves = [
            LeaveRequest(employee_id="emp-2", leave_type="annual", start_date=_shift(7), end_date=_shift(9), reason="سفر عائلي", status="pending"),
            LeaveRequest(employee_id="emp-3", leave_type="sick", start_date=_shift(-1), end_date=_shift(0), reason="إرتياح بعد عملية بسيطة", status="pending"),
            LeaveRequest(employee_id="emp-5", leave_type="annual", start_date=_shift(-25), end_date=_shift(-20), reason="إجازة سنوية", status="approved", manager_note="تمت الموافقة — استمتع بإجازتك"),
            LeaveRequest(employee_id="emp-4", leave_type="unpaid", start_date=_shift(10), end_date=_shift(11), reason="ظرف خاص", status="rejected", manager_note="فترة إقفال شهري — يرجى التقديم لاحقاً"),
        ]
        await db.leaves.insert_many([l.model_dump() for l in leaves])
        print(f"seeded {len(leaves)} leave requests")

    if await db.payroll.count_documents({}) == 0:
        month = current_month()
        items = []
        for e in EMPLOYEES:
            item = PayrollItem(
                employee_id=e["id"],
                month=month,
                base_salary=e["base_salary"],
                allowances=e["allowances"],
                deductions=0,
                net=e["base_salary"] + e["allowances"],
            )
            if e["id"] == "emp-1":
                item.status = "paid"
            items.append(item.model_dump())
        await db.payroll.insert_many(items)
        print(f"seeded {len(items)} payroll items for {month}")

    print("seed done —", await db.employees.count_documents({}), "employees in db")


if __name__ == "__main__":
    asyncio.run(main())