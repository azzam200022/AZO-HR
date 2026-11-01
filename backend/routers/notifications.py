from fastapi import APIRouter, Depends, HTTPException

from lib.auth import require_manager
from lib.dates import aware
from lib.db import db
from models.hr import MarkAllResult, Notification, NotificationSummary

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
