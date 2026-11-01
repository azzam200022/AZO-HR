from fastapi import APIRouter, Depends, HTTPException

from lib.auth import Principal, require_manager
from lib.db import db
from lib.messaging import GROUP_THREAD, mark_thread_read, send_message, to_model
from models.hr import (
    BroadcastResult,
    MarkAllResult,
    Message,
    MessageSend,
    MessageThread,
)

router = APIRouter(prefix="/messages", tags=["messages"], dependencies=[Depends(require_manager)])


@router.get("/threads", response_model=list[MessageThread])
async def list_threads():
    """One row per employee plus the team channel, newest activity first."""
    employees = await db.employees.find({}).sort("name", 1).to_list(1000)
    threads: list[MessageThread] = []

    group_docs = await db.messages.find({"thread": GROUP_THREAD}).sort("created_at", -1).to_list(500)
    threads.append(
        MessageThread(
            thread=GROUP_THREAD,
            employee_id="",
            name="مجموعة الفريق",
            job_title="إعلانات لكل الموظفين",
            messages=len(group_docs),
            unread=sum(1 for d in group_docs if not d.get("read_by_manager")),
            last_body=(group_docs[0].get("body", "") if group_docs else ""),
            last_at=(group_docs[0].get("created_at").isoformat() if group_docs else ""),
        )
    )

    for emp in employees:
        docs = (
            await db.messages.find({"thread": "direct", "employee_id": emp["id"]})
            .sort("created_at", -1)
            .to_list(500)
        )
        threads.append(
            MessageThread(
                thread="direct",
                employee_id=emp["id"],
                name=emp.get("name", ""),
                job_title=emp.get("job_title", ""),
                messages=len(docs),
                unread=sum(1 for d in docs if not d.get("read_by_manager")),
                last_body=(docs[0].get("body", "") if docs else ""),
                last_at=(docs[0].get("created_at").isoformat() if docs else ""),
            )
        )
    return threads


@router.get("", response_model=list[Message])
async def list_messages(employee_id: str | None = None):
    """Messages of one private thread, or the team channel when no employee is given."""
    query: dict = (
        {"thread": "direct", "employee_id": employee_id} if employee_id else {"thread": GROUP_THREAD}
    )
    docs = await db.messages.find(query).sort("created_at", 1).to_list(500)
    return [to_model(d) for d in docs]


@router.post("", response_model=Message, status_code=201)
async def post_message(payload: MessageSend, principal: Principal = Depends(require_manager)):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="لا يمكن إرسال رسالة فارغة")
    if payload.thread == "direct":
        if not payload.employee_id:
            raise HTTPException(status_code=400, detail="اختر الموظف المرسل إليه")
        if not await db.employees.find_one({"id": payload.employee_id}):
            raise HTTPException(status_code=404, detail="الموظف غير موجود")
    return await send_message(
        thread=payload.thread,
        employee_id=payload.employee_id,
        sender="manager",
        sender_name=principal.name or "الإدارة",
        body=payload.body,
    )


@router.post("/broadcast", response_model=BroadcastResult, status_code=201)
async def broadcast(payload: MessageSend, principal: Principal = Depends(require_manager)):
    """Send the same message into every active employee's private thread."""
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="لا يمكن إرسال رسالة فارغة")
    employees = await db.employees.find({"status": "active"}).to_list(1000)
    for emp in employees:
        await send_message(
            thread="direct",
            employee_id=emp["id"],
            sender="manager",
            sender_name=principal.name or "الإدارة",
            body=payload.body,
        )
    return BroadcastResult(sent=len(employees))


@router.post("/read", response_model=MarkAllResult)
async def mark_read(payload: MessageSend):
    updated = await mark_thread_read(
        thread=payload.thread, employee_id=payload.employee_id, reader="manager"
    )
    return MarkAllResult(updated=updated)
