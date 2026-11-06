"""Background delivery for reminders before each employee's scheduled shift."""

import asyncio
import logging
from datetime import datetime, time, timedelta

from lib.dates import now_local
from lib.shift import employee_shift, is_working_day

logger = logging.getLogger(__name__)

REMINDER_LEAD_MINUTES = (60, 30, 15)
REMINDER_GRACE = timedelta(minutes=2)
SCHEDULER_INTERVAL_SECONDS = 60


def due_shift_reminders(employee: dict, now: datetime) -> list[tuple[str, str, int]]:
    """Return due (work date, shift start, lead minutes) reminders for a local instant."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=now_local().tzinfo)

    shift_start, _shift_end, _grace = employee_shift(employee)
    try:
        start_clock = time.fromisoformat(shift_start)
    except (TypeError, ValueError):
        return []

    due: list[tuple[str, str, int]] = []
    # Include tomorrow so a 00:00–01:00 shift can be reminded before midnight.
    for days_ahead in (0, 1):
        shift_date = now.date() + timedelta(days=days_ahead)
        work_date = shift_date.isoformat()
        if not is_working_day(work_date, employee.get("work_days")):
            continue

        shift_at = datetime.combine(shift_date, start_clock, tzinfo=now.tzinfo)
        for lead_minutes in REMINDER_LEAD_MINUTES:
            reminder_at = shift_at - timedelta(minutes=lead_minutes)
            if reminder_at <= now < reminder_at + REMINDER_GRACE:
                due.append((work_date, shift_start, lead_minutes))
    return due


async def run_shift_reminder_cycle(
    now: datetime | None = None,
    *,
    database=None,
    reminder_sender=None,
) -> int:
    """Find due reminders and skip employees who checked in or have approved leave."""
    if database is None:
        from lib.db import db as database
    if reminder_sender is None:
        from lib.notify import notify_employee_shift_reminder

        reminder_sender = notify_employee_shift_reminder

    current = now or now_local()
    cursor = database.employees.find(
        {"status": "active", "can_login": {"$ne": False}},
        {
            "id": 1,
            "name": 1,
            "shift_start": 1,
            "shift_end": 1,
            "work_days": 1,
            "status": 1,
            "can_login": 1,
        },
    )
    attempted = 0
    async for employee in cursor:
        employee_id = employee.get("id")
        if not employee_id:
            continue

        for work_date, shift_start, lead_minutes in due_shift_reminders(employee, current):
            attendance = await database.attendance.find_one(
                {"employee_id": employee_id, "date": work_date}
            )
            if attendance and attendance.get("check_in"):
                continue

            approved_leave = await database.leaves.find_one(
                {
                    "employee_id": employee_id,
                    "status": "approved",
                    "start_date": {"$lte": work_date},
                    "end_date": {"$gte": work_date},
                }
            )
            if approved_leave:
                continue

            await reminder_sender(
                employee=employee,
                work_date=work_date,
                shift_start=shift_start,
                minutes_before=lead_minutes,
            )
            attempted += 1
    return attempted


async def run_shift_reminder_scheduler(index_task=None) -> None:
    """Poll on a short interval; stable notification IDs make restarts safe."""
    if index_task is not None:
        try:
            await index_task
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Notification indexes were not ready (%s)", type(exc).__name__)

    while True:
        try:
            await run_shift_reminder_cycle()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Shift reminder cycle failed (%s)", type(exc).__name__)
        await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)
