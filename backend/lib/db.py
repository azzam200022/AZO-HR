"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"].strip()
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "employees": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("status", ASCENDING), ("hire_date", ASCENDING)], name="status_hire_date"),
        IndexModel([("access_code", ASCENDING)], name="access_code"),
    ],
    "attendance": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("date", DESCENDING), ("employee_id", ASCENDING)], name="date_employee"),
        IndexModel([("employee_id", ASCENDING), ("date", DESCENDING)], name="employee_date"),
    ],
    "attendance_archive": [
        IndexModel([("id", ASCENDING)], name="id"),
        IndexModel([("date", DESCENDING), ("employee_id", ASCENDING)], name="date_employee"),
        IndexModel([("employee_id", ASCENDING), ("date", DESCENDING)], name="employee_date"),
    ],
    "leaves": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
        IndexModel([("employee_id", ASCENDING), ("status", ASCENDING), ("start_date", ASCENDING), ("end_date", ASCENDING)], name="employee_status_dates"),
    ],
    "payroll": [
        IndexModel([("id", ASCENDING)], name="id", unique=True),
        IndexModel([("month", ASCENDING), ("employee_id", ASCENDING)], name="month_employee"),
    ],
    "locations": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "users": [IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "sessions": [
        IndexModel([("token", ASCENDING)], name="token", unique=True),
        IndexModel([("employee_id", ASCENDING)], name="employee"),
    ],
    "push_tokens": [
        IndexModel([("token", ASCENDING)], name="token", unique=True),
        IndexModel([("role", ASCENDING), ("employee_id", ASCENDING)], name="recipient"),
    ],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
