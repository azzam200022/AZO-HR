"""In-app notifications for managers and employees."""

import logging

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


async def notify_employee_adjustment(employee: dict, adjustment: dict) -> None:
    'Create a private in-app alert when a bonus or deduction is recorded.'
    kind = adjustment.get('kind')
    if kind not in {'bonus', 'deduction'}:
        return

    label = 'حافز' if kind == 'bonus' else 'خصم'
    amount = float(adjustment.get('amount', 0))
    note = Notification(
        kind=kind,
        audience='employee',
        employee_id=employee['id'],
        employee_name=employee.get('name', ''),
        date=adjustment.get('date') or today_iso(),
        at_time=now_time(),
        message=(
            f'تم تسجيل {label} بقيمة {amount:,.0f} د.ع. '
            f'السبب: {adjustment.get("reason", "")}'
        ),
    )
    try:
        await db.notifications.insert_one(note.model_dump())
    except Exception:
        # Keep the saved adjustment successful if the separate notification insert fails.
        logging.getLogger(__name__).exception(
            'Could not create employee notification for adjustment %s', adjustment.get('id')
        )
