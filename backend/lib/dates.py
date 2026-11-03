"""Server-side date helpers. Default to Iraq time; never anchor business dates to the browser."""

import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def _zone(tz: str | None = None) -> ZoneInfo:
    return ZoneInfo(tz or os.environ.get("APP_TZ") or "Asia/Baghdad")


def today_iso(tz: str | None = None) -> str:
    """Today's date as YYYY-MM-DD in `tz` (default: APP_TZ env, else Asia/Baghdad)."""
    return datetime.now(_zone(tz)).strftime("%Y-%m-%d")


def now_time(tz: str | None = None) -> str:
    """Current wall-clock time as HH:MM (24h) in `tz`."""
    return datetime.now(_zone(tz)).strftime("%H:%M")


def current_month(tz: str | None = None) -> str:
    """Current month as YYYY-MM in `tz`."""
    return datetime.now(_zone(tz)).strftime("%Y-%m")


def past_days(n: int, tz: str | None = None) -> list[str]:
    """ISO dates for the last `n` days, oldest first, ending today."""
    now = datetime.now(_zone(tz))
    return [(now - timedelta(days=k)).strftime("%Y-%m-%d") for k in range(n - 1, -1, -1)]


def aware(value):
    """Motor hands back naive UTC datetimes — mark them aware so Pydantic serialises an offset."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value