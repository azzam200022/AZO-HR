"""Messaging between the manager and employees.

Two channels only: a private thread per employee, and one public team channel. The thread
an employee may read is always derived from the session, never from a client-supplied id.
"""

from lib.dates import aware, now_time, today_iso
from lib.db import db
from models.hr import Message, Notification

GROUP_THREAD = "group"


async def _notify(
    *,
    audience: str,
    employee_id: str,
    employee_name: str,
    message: str,
) -> None:
    note = Notification(
        kind="message",
        audience=audience,
        employee_id=employee_id,
        employee_name=employee_name,
        date=today_iso(),
        at_time=now_time(),
        minutes=0,
        message=message,
    )
    await db.notifications.insert_one(note.model_dump())


async def send_message(
    *,
    thread: str,
    employee_id: str,
    sender: str,
    sender_name: str,
    body: str,
) -> Message:
    """Persist a message and raise an in-app notification for the other side."""
    msg = Message(
        thread=thread,
        employee_id=employee_id if thread == "direct" else "",
        sender=sender,
        sender_name=sender_name,
        body=body.strip(),
        read_by_manager=sender == "manager",
        read_by_employee=sender == "employee",
    )
    await db.messages.insert_one(msg.model_dump())

    preview = body.strip()[:60]
    if sender == "manager":
        if thread == "direct":
            employee = await db.employees.find_one({"id": employee_id})
            await _notify(
                audience="employee",
                employee_id=employee_id,
                employee_name=(employee or {}).get("name", ""),
                message=f"رسالة جديدة من الإدارة: {preview}",
            )
        else:
            for emp in await db.employees.find({"status": "active"}).to_list(1000):
                await _notify(
                    audience="employee",
                    employee_id=emp["id"],
                    employee_name=emp.get("name", ""),
                    message=f"إعلان جديد للفريق: {preview}",
                )
    else:
        await _notify(
            audience="manager",
            employee_id=employee_id,
            employee_name=sender_name,
            message=(
                f"رسالة جديدة من {sender_name}: {preview}"
                if thread == "direct"
                else f"{sender_name} كتب في مجموعة الفريق: {preview}"
            ),
        )
    return msg


def to_model(doc: dict) -> Message:
    doc["created_at"] = aware(doc.get("created_at"))
    return Message(**doc)


async def mark_thread_read(*, thread: str, employee_id: str, reader: str) -> int:
    """Clear unread flags for one side of a thread."""
    field = "read_by_manager" if reader == "manager" else "read_by_employee"
    query: dict = {"thread": thread, field: False}
    if thread == "direct":
        query["employee_id"] = employee_id
    result = await db.messages.update_many(query, {"$set": {field: True}})

    # Message notifications for that reader are stale once the thread is open.
    note_query: dict = {"kind": "message", "read": False}
    if reader == "manager":
        note_query["audience"] = "manager"
    else:
        note_query.update({"audience": "employee", "employee_id": employee_id})
    await db.notifications.update_many(note_query, {"$set": {"read": True}})
    return result.modified_count
