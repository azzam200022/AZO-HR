"""In-app reminders for employee-owned product expiry dates."""

import asyncio
import logging
from calendar import monthrange
from datetime import date, timedelta

from lib.dates import today_iso

logger = logging.getLogger(__name__)

SCHEDULER_INTERVAL_SECONDS = 60
REMINDER_LABELS = {
    "month": "شهر",
    "15": "15 يومًا",
    "10": "10 أيام",
    "7": "7 أيام",
}


def one_calendar_month_before(expiry: date) -> date:
    """Subtract one calendar month, clamping end-of-month dates when needed."""
    month_index = expiry.year * 12 + expiry.month - 2
    year, month_zero_based = divmod(month_index, 12)
    month = month_zero_based + 1
    day = min(expiry.day, monthrange(year, month)[1])
    return date(year, month, day)


def expiry_reminder_targets(expiry: date) -> list[tuple[str, date]]:
    """Return stable reminder keys and target local dates for an expiry."""
    return [
        ("month", one_calendar_month_before(expiry)),
        ("15", expiry - timedelta(days=15)),
        ("10", expiry - timedelta(days=10)),
        ("7", expiry - timedelta(days=7)),
    ]


def due_expiry_reminders(expiry_date: str, today: date) -> list[tuple[str, str]]:
    """Return reminder key/label pairs due on this local date."""
    try:
        expiry = date.fromisoformat(expiry_date)
    except (TypeError, ValueError):
        return []

    return [
        (key, REMINDER_LABELS[key])
        for key, target in expiry_reminder_targets(expiry)
        if target == today
    ]


def expiry_status(days_remaining: int) -> str:
    if days_remaining < 0:
        return "expired"
    if days_remaining <= 30:
        return "near"
    return "far"


async def run_product_expiry_reminder_cycle(
    today: date | None = None,
    *,
    database=None,
    reminder_sender=None,
) -> int:
    """Send due reminders only to the active employee who registered each product."""
    if database is None:
        from lib.db import db as database
    if reminder_sender is None:
        async def send_reminder(**kwargs):
            from lib.notify import notify_employee_product_expiry

            return await notify_employee_product_expiry(**kwargs)

        reminder_sender = send_reminder

    current_date = today or date.fromisoformat(today_iso())
    employees: dict[str, dict | None] = {}
    attempted = 0

    async for product in database.employee_products.find({}):
        employee_id = product.get("employee_id")
        product_id = product.get("id")
        if not employee_id or not product_id:
            continue

        if employee_id not in employees:
            employees[employee_id] = await database.employees.find_one({"id": employee_id})
        employee = employees[employee_id]
        if (
            not employee
            or employee.get("status") != "active"
            or not employee.get("can_login", True)
        ):
            continue

        for batch in product.get("expiry_dates") or []:
            batch_id = batch.get("id")
            expiry_date = batch.get("expiry_date")
            if not batch_id or not expiry_date:
                continue
            for reminder_key, reminder_label in due_expiry_reminders(expiry_date, current_date):
                await reminder_sender(
                    employee=employee,
                    product_id=product_id,
                    product_name=product.get("name", ""),
                    batch_id=batch_id,
                    expiry_date=expiry_date,
                    reminder_key=reminder_key,
                    reminder_label=reminder_label,
                )
                attempted += 1
    return attempted


async def run_product_expiry_reminder_scheduler(index_task=None) -> None:
    """Poll daily dates; notification IDs make minute-level polling idempotent."""
    if index_task is not None:
        try:
            await index_task
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Product expiry indexes were not ready (%s)", type(exc).__name__)

    while True:
        try:
            await run_product_expiry_reminder_cycle()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Product expiry reminder cycle failed (%s)", type(exc).__name__)
        await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)
