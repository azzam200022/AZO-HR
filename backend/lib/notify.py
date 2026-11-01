"""Manager notifications — raised the moment an employee is late or leaves the site."""

from lib.dates import now_time, today_iso
from lib.db import db
from models.hr import Notification


async def notify_manager(
    *,
    kind: str,
    employee: dict,
    minutes: int,
    message: str,
) -> Notification:
    note = Notification(
        kind=kind,  # "late" | "left_site"
        audience="manager",
        employee_id=employee["id"],
        employee_name=employee.get("name", ""),
        date=today_iso(),
        at_time=now_time(),
        minutes=minutes,
        message=message,
    )
    await db.notifications.insert_one(note.model_dump())
    return note


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
