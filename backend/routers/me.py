"""Employee self-service surface.

Every route here resolves the employee from the SESSION, never from a client-supplied id —
that is what makes cross-employee access (IDOR/BOLA) structurally impossible rather than
merely checked.
"""

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, require_employee
from lib.dates import aware, current_month
from lib.db import db
from lib.adjustments import to_model as adjustment_model
from lib.messaging import GROUP_THREAD, mark_thread_read, send_message, to_model as message_model
from lib.punch import punch_in, punch_out, record_presence
from lib.reports import build_report, leave_balance
from lib.shift import employee_shift, is_working_day, late_minutes
from models.hr import (
    Adjustment,
    AttendanceRecord,
    Employee,
    EmployeeReport,
    LeaveBalance,
    LeaveRequest,
    MarkAllResult,
    Message,
    MessageSend,
    Notification,
    NotificationSummary,
    PayrollItem,
    PresenceStatus,
    SelfLeaveCreate,
    SelfPunch,
    WorkLocation,
)

router = APIRouter(prefix="/me", tags=["self-service"])


async def _my_employee(principal: Principal) -> dict:
    doc = await db.employees.find_one({"id": principal.employee_id})
    if not doc:
        raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return doc


@router.get("/profile", response_model=Employee)
async def my_profile(principal: Principal = Depends(require_employee)):
    doc = await _my_employee(principal)
    doc["created_at"] = aware(doc.get("created_at"))
    return Employee(**doc)


@router.get("/location", response_model=WorkLocation | None)
async def my_location(principal: Principal = Depends(require_employee)):
    doc = await _my_employee(principal)
    if not doc.get("location_id"):
        return None
    loc = await db.locations.find_one({"id": doc["location_id"]})
    if not loc:
        return None
    loc["created_at"] = aware(loc.get("created_at"))
    return WorkLocation(**loc)


@router.get("/attendance", response_model=list[AttendanceRecord])
async def my_attendance(principal: Principal = Depends(require_employee)):
    employee = await _my_employee(principal)
    shift_start, _shift_end, grace = employee_shift(employee)
    docs = (
        await db.attendance.find({"employee_id": principal.employee_id})
        .sort("date", -1)
        .to_list(500)
    )
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
        d["late_minutes"] = late_minutes(
            d.get("check_in", ""),
            shift_start,
            grace,
            work_date=d.get("date"),
            work_days=employee.get("work_days"),
        )
        if not is_working_day(d.get("date", ""), employee.get("work_days")):
            d["away_minutes"] = 0
    return [AttendanceRecord(**d) for d in docs]


@router.post("/check-in", response_model=AttendanceRecord)
async def my_check_in(payload: SelfPunch, principal: Principal = Depends(require_employee)):
    employee = await _my_employee(principal)
    return await punch_in(employee, payload.lat, payload.lng)


@router.post("/check-out", response_model=AttendanceRecord)
async def my_check_out(principal: Principal = Depends(require_employee)):
    doc = await punch_out(principal.employee_id)
    doc["created_at"] = aware(doc.get("created_at"))
    return AttendanceRecord(**doc)


@router.post("/presence", response_model=PresenceStatus)
async def my_presence(payload: SelfPunch, principal: Principal = Depends(require_employee)):
    """Location heartbeat while punched in — leaving the site accrues away minutes."""
    employee = await _my_employee(principal)
    doc = await record_presence(employee, payload.lat, payload.lng)
    late = int(doc.get("late_minutes", 0))
    away = int(doc.get("away_minutes", 0))
    return PresenceStatus(
        inside=bool(doc.get("_inside", True)),
        distance_m=round(doc["_distance"], 1) if doc.get("_distance") is not None else None,
        away_minutes=away,
        late_minutes=late,
        total_late_minutes=late + away,
        tracking=bool(doc.get("_tracking", False)),
        checked_out=bool(doc.get("check_out")),
    )


@router.get("/leaves", response_model=list[LeaveRequest])
async def my_leaves(principal: Principal = Depends(require_employee)):
    docs = (
        await db.leaves.find({"employee_id": principal.employee_id})
        .sort("created_at", -1)
        .to_list(500)
    )
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
    return [LeaveRequest(**d) for d in docs]


@router.get("/leave-balance", response_model=LeaveBalance)
async def my_leave_balance(principal: Principal = Depends(require_employee)):
    return await leave_balance(await _my_employee(principal))


@router.get("/report", response_model=EmployeeReport)
async def my_report(month: str | None = None, principal: Principal = Depends(require_employee)):
    return await build_report(await _my_employee(principal), month)


@router.post("/leaves", response_model=LeaveRequest, status_code=201)
async def request_leave(payload: SelfLeaveCreate, principal: Principal = Depends(require_employee)):
    # The session decides whose leave this is — the body carries no employee_id at all.
    employee = await _my_employee(principal)
    if payload.end_date < payload.start_date:
        raise HTTPException(
            status_code=400, detail="تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو مساوياً له"
        )

    # Monthly quota, counted over the employee's hire-date cycle (not the calendar month).
    balance = await leave_balance(employee)
    if balance.remaining <= 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"استنفدت رصيد إجازاتك لهذه الدورة ({balance.used} من {balance.quota}) — "
                f"الدورة الحالية {balance.cycle_start} إلى {balance.cycle_end}. "
                "يمكنك التقديم بعد بداية الدورة القادمة."
            ),
        )
    if not (balance.cycle_start <= payload.start_date <= balance.cycle_end):
        raise HTTPException(
            status_code=400,
            detail=(
                f"يمكنك طلب إجازة ضمن دورتك الحالية فقط ({balance.cycle_start} إلى {balance.cycle_end})"
            ),
        )

    leave = LeaveRequest(
        **{**payload.model_dump(), "employee_id": principal.employee_id},
    )
    await db.leaves.insert_one(leave.model_dump())
    return leave


@router.get("/notifications", response_model=list[Notification])
async def my_notifications(limit: int = 30, principal: Principal = Depends(require_employee)):
    docs = (
        await db.notifications.find({"audience": "employee", "employee_id": principal.employee_id})
        .sort("created_at", -1)
        .to_list(min(limit, 100))
    )
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
    return [Notification(**d) for d in docs]


@router.get("/notifications/summary", response_model=NotificationSummary)
async def my_notifications_summary(principal: Principal = Depends(require_employee)):
    base = {"audience": "employee", "employee_id": principal.employee_id}
    unread = await db.notifications.count_documents({**base, "read": False})
    total = await db.notifications.count_documents(base)
    return NotificationSummary(unread=unread, total=total)


@router.post("/notifications/read-all", response_model=MarkAllResult)
async def read_my_notifications(principal: Principal = Depends(require_employee)):
    result = await db.notifications.update_many(
        {"audience": "employee", "employee_id": principal.employee_id, "read": False},
        {"$set": {"read": True}},
    )
    return MarkAllResult(updated=result.modified_count)


@router.get("/messages", response_model=list[Message])
async def my_messages(thread: str = "direct", principal: Principal = Depends(require_employee)):
    """Own private thread with the manager, or the team channel."""
    query: dict = (
        {"thread": GROUP_THREAD}
        if thread == GROUP_THREAD
        else {"thread": "direct", "employee_id": principal.employee_id}
    )
    docs = await db.messages.find(query).sort("created_at", 1).to_list(500)
    return [message_model(d) for d in docs]


@router.post("/messages", response_model=Message, status_code=201)
async def send_my_message(payload: MessageSend, principal: Principal = Depends(require_employee)):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="لا يمكن إرسال رسالة فارغة")
    employee = await _my_employee(principal)
    # The employee id always comes from the session — a spoofed one in the body is ignored.
    return await send_message(
        thread=payload.thread,
        employee_id=employee["id"],
        sender="employee",
        sender_name=employee.get("name", ""),
        body=payload.body,
    )


@router.post("/messages/read", response_model=MarkAllResult)
async def read_my_messages(payload: MessageSend, principal: Principal = Depends(require_employee)):
    updated = await mark_thread_read(
        thread=payload.thread, employee_id=principal.employee_id, reader="employee"
    )
    return MarkAllResult(updated=updated)


@router.get("/adjustments", response_model=list[Adjustment])
async def my_adjustments(principal: Principal = Depends(require_employee)):
    """Own bonuses and deductions, each with the reason the manager stated."""
    docs = (
        await db.adjustments.find({"employee_id": principal.employee_id})
        .sort("date", -1)
        .to_list(300)
    )
    return [adjustment_model(d) for d in docs]


@router.get("/payroll", response_model=list[PayrollItem])
async def my_payroll(month: str | None = None, principal: Principal = Depends(require_employee)):
    docs = await db.payroll.find(
        {"employee_id": principal.employee_id, "month": month or current_month()}
    ).to_list(100)
    for d in docs:
        d["created_at"] = aware(d.get("created_at"))
    return [PayrollItem(**d) for d in docs]