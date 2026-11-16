from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.dates import aware
from lib.db import db
from models.hr import MarkAllResult, Notification, NotificationSummary
from models.auth import DeviceChangeDecision, DeviceChangeRequestView

router = APIRouter(
    prefix="/notifications", tags=["notifications"], dependencies=[Depends(require_manager)]
)


def _to_model(doc: dict) -> Notification:
    doc["created_at"] = aware(doc.get("created_at"))
    return Notification(**doc)


@router.get("", response_model=list[Notification])
async def list_notifications(unread_only: bool = False, limit: int = 50):
    query: dict = {"audience": {"$ne": "employee"}}
    if unread_only:
        query["read"] = False
    docs = await db.notifications.find(query).sort("created_at", -1).to_list(min(limit, 200))
    return [_to_model(d) for d in docs]


@router.get("/summary", response_model=NotificationSummary)
async def notifications_summary():
    base = {"audience": {"$ne": "employee"}}
    unread = await db.notifications.count_documents({**base, "read": False})
    total = await db.notifications.count_documents(base)
    return NotificationSummary(unread=unread, total=total)


@router.get("/device-change-requests", response_model=list[DeviceChangeRequestView])
async def list_device_change_requests():
    """Pending device approvals are separate from the rolling notification feed."""
    docs = (
        await db.device_change_requests.find(
            {"pending_employee_id": {"$exists": True}}
        )
        .sort("created_at", -1)
        .to_list(100)
    )
    return [
        DeviceChangeRequestView(
            id=doc["id"],
            employee_id=doc["employee_id"],
            employee_name=doc.get("employee_name", ""),
            device_hint=(doc.get("device_id") or "")[-8:],
            created_at=aware(doc.get("created_at")),
        )
        for doc in docs
    ]


async def _mark_device_request_notifications_read(request_id: str) -> None:
    await db.notifications.update_many(
        {"device_request_id": request_id},
        {"$set": {"read": True}},
    )


@router.post(
    "/device-change-requests/{request_id}/approve",
    response_model=DeviceChangeDecision,
)
async def approve_device_change_request(request_id: str):
    request = await db.device_change_requests.find_one(
        {
            "id": request_id,
            "status": "pending",
            "pending_employee_id": {"$exists": True},
        }
    )
    if not request:
        raise HTTPException(status_code=404, detail="طلب الجهاز غير موجود أو تمت معالجته")

    employee = await db.employees.find_one({"id": request["employee_id"]})
    if not employee:
        raise HTTPException(status_code=404, detail="الموظف المرتبط بالطلب غير موجود")
    if not employee.get("can_login", True) or employee.get("status") != "active":
        raise HTTPException(status_code=409, detail="حساب الموظف غير نشط؛ لم يتم اعتماد الجهاز")

    device_id = request["device_id"]
    current_device_id = employee.get("trusted_device_id") or ""
    previous_device_id = request.get("previous_device_id") or ""
    if current_device_id not in {previous_device_id, device_id}:
        raise HTTPException(
            status_code=409,
            detail="تغيّر الجهاز المعتمد منذ إنشاء الطلب؛ حدّث الصفحة وراجع الطلب مجددًا",
        )

    if current_device_id != device_id:
        employee_filter: dict = {"id": request["employee_id"]}
        if previous_device_id:
            employee_filter["trusted_device_id"] = previous_device_id
        else:
            employee_filter["$or"] = [
                {"trusted_device_id": {"$exists": False}},
                {"trusted_device_id": None},
                {"trusted_device_id": ""},
            ]
        result = await db.employees.update_one(
            employee_filter,
            {"$set": {"trusted_device_id": device_id}},
        )
        if not result.matched_count:
            refreshed = await db.employees.find_one({"id": request["employee_id"]})
            if (refreshed or {}).get("trusted_device_id") != device_id:
                raise HTTPException(status_code=409, detail="تعذر اعتماد هذا الجهاز؛ أعد تحميل الطلب")

    # Revoke the old login and its notification endpoints as soon as the manager
    # approves the replacement. The employee must sign in again on the approved device.
    employee_query = {"role": "employee", "employee_id": request["employee_id"]}
    await db.sessions.delete_many(employee_query)
    await db.push_tokens.delete_many(employee_query)
    await db.web_push_subscriptions.delete_many(employee_query)

    result = await db.device_change_requests.update_one(
        {
            "id": request_id,
            "status": "pending",
            "pending_employee_id": request["employee_id"],
        },
        {
            "$set": {
                "status": "approved",
                "resolved_at": datetime.now(timezone.utc),
            },
            "$unset": {"pending_employee_id": ""},
        },
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="تمت معالجة الطلب بالفعل")
    await _mark_device_request_notifications_read(request_id)
    return DeviceChangeDecision(id=request_id, status="approved")


@router.post(
    "/device-change-requests/{request_id}/reject",
    response_model=DeviceChangeDecision,
)
async def reject_device_change_request(request_id: str):
    result = await db.device_change_requests.update_one(
        {
            "id": request_id,
            "status": "pending",
            "pending_employee_id": {"$exists": True},
        },
        {
            "$set": {
                "status": "rejected",
                "resolved_at": datetime.now(timezone.utc),
            },
            "$unset": {"pending_employee_id": ""},
        },
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="طلب الجهاز غير موجود أو تمت معالجته")
    await _mark_device_request_notifications_read(request_id)
    return DeviceChangeDecision(id=request_id, status="rejected")


@router.post("/{note_id}/read", response_model=Notification)
async def mark_read(note_id: str):
    doc = await db.notifications.find_one({"id": note_id})
    if not doc:
        raise HTTPException(status_code=404, detail="الإشعار غير موجود")
    await db.notifications.update_one({"id": note_id}, {"$set": {"read": True}})
    return _to_model(await db.notifications.find_one({"id": note_id}))


@router.post("/read-all", response_model=MarkAllResult)
async def mark_all_read():
    result = await db.notifications.update_many(
        {"read": False, "audience": {"$ne": "employee"}}, {"$set": {"read": True}}
    )
    return MarkAllResult(updated=result.modified_count)
