"""In-app notifications for managers and employees."""

import logging

from lib.dates import now_time, today_iso
from lib.db import db
from lib.push import send_notification
from models.hr import Notification

logger = logging.getLogger(__name__)


async def _create_notification(
    *,
    kind: str,
    audience: str,
    employee: dict,
    message: str,
    date: str | None = None,
    minutes: int = 0,
) -> Notification:
    note = Notification(
        kind=kind,
        audience=audience,
        employee_id=employee["id"],
        employee_name=employee.get("name", ""),
        date=date or today_iso(),
        at_time=now_time(),
        minutes=minutes,
        message=message,
    )
    try:
        await db.notifications.insert_one(note.model_dump())
    except Exception as exc:
        # Avoid exposing database or credential details in application logs.
        logger.warning("Could not save %s notification (%s)", kind, type(exc).__name__)
        return note
    try:
        await send_notification(note.model_dump())
    except Exception as exc:
        logger.warning("Could not send %s notification (%s)", kind, type(exc).__name__)
    return note


async def notify_manager(
    *,
    kind: str,
    employee: dict,
    minutes: int,
    message: str,
    date: str | None = None,
) -> Notification:
    return await _create_notification(
        kind=kind,
        audience="manager",
        employee=employee,
        minutes=minutes,
        message=message,
        date=date,
    )


async def notify_manager_event(
    *,
    kind: str,
    employee: dict,
    message: str,
    date: str | None = None,
    minutes: int = 0,
) -> Notification:
    return await notify_manager(
        kind=kind,
        employee=employee,
        minutes=minutes,
        message=message,
        date=date,
    )


async def notify_employee_event(
    *,
    kind: str,
    employee: dict,
    message: str,
    date: str | None = None,
) -> Notification:
    return await _create_notification(
        kind=kind,
        audience="employee",
        employee=employee,
        message=message,
        date=date,
    )


async def notify_late(employee: dict, late: int, shift_start: str, punched_at: str) -> None:
    await notify_manager(
        kind="late",
        employee=employee,
        minutes=late,
        message=(
            f"تأخر {employee.get('name', '')} عن دوامه — بصم الحضور {punched_at} "
            f"بينما يبدأ دوامه {shift_start} (تأخير {late} دقيقة)"
        ),
    )


async def notify_left_site(employee: dict, location_name: str, at_time: str, distance_m: float) -> None:
    await notify_manager(
        kind="left_site",
        employee=employee,
        minutes=0,
        message=(
            f"غادر {employee.get('name', '')} موقع العمل «{location_name}» الساعة {at_time} "
            f"أثناء دوامه — يبعد الآن {int(distance_m)} متراً"
        ),
    )


async def notify_employee_adjustment(employee: dict, adjustment: dict) -> None:
    """Create a private alert when a bonus or deduction is recorded."""
    kind = adjustment.get("kind")
    if kind not in {"bonus", "deduction"}:
        return

    label = "حافز" if kind == "bonus" else "خصم"
    amount = float(adjustment.get("amount", 0))
    await notify_employee_event(
        kind=kind,
        employee=employee,
        date=adjustment.get("date") or today_iso(),
        message=(
            f"تم تسجيل {label} بقيمة {amount:,.0f} د.ع. "
            f"السبب: {adjustment.get('reason', '')}"
        ),
    )


async def notify_employee_shift_reminder(
    employee: dict,
    *,
    work_date: str,
    shift_start: str,
    minutes_before: int,
) -> bool:
    """Persist and push one shift reminder, deduplicated across scheduler restarts."""
    labels = {
        60: "ساعة",
        30: "نصف ساعة",
        15: "15 دقيقة",
    }
    label = labels.get(minutes_before)
    if not label:
        return False

    note = Notification(
        id=f"shift-reminder:{employee['id']}:{work_date}:{minutes_before}",
        kind="shift_reminder",
        audience="employee",
        employee_id=employee["id"],
        employee_name=employee.get("name", ""),
        date=work_date,
        at_time=now_time(),
        minutes=minutes_before,
        message=f"يبدأ دوامك الساعة {shift_start} — تبقّى {label}.",
    )
    try:
        result = await db.notifications.update_one(
            {"id": note.id},
            {"$setOnInsert": note.model_dump()},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("Could not save shift reminder (%s)", type(exc).__name__)
        return False

    if result.upserted_id is None:
        return False
    try:
        await send_notification(note.model_dump())
    except Exception as exc:
        logger.warning("Could not send shift reminder (%s)", type(exc).__name__)
    return True


async def notify_employee_shift_end_reminder(
    employee: dict,
    *,
    work_date: str,
    shift_end: str,
) -> bool:
    """Persist and push a single end-of-shift reminder."""
    note = Notification(
        id=f"shift-end-reminder:{employee['id']}:{work_date}",
        kind="shift_reminder",
        audience="employee",
        employee_id=employee["id"],
        employee_name=employee.get("name", ""),
        date=work_date,
        at_time=now_time(),
        message=f"ينتهي دوامك الساعة {shift_end} — لا تنسَ تسجيل الانصراف.",
    )
    try:
        result = await db.notifications.update_one(
            {"id": note.id},
            {"$setOnInsert": note.model_dump()},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("Could not save shift-end reminder (%s)", type(exc).__name__)
        return False

    if result.upserted_id is None:
        return False
    try:
        await send_notification(note.model_dump())
    except Exception as exc:
        logger.warning("Could not send shift-end reminder (%s)", type(exc).__name__)
    return True
