"""Firebase Cloud Messaging delivery for existing in-app notifications.

The in-app notification is always saved first. Missing Firebase configuration or a
temporary FCM error must never make the underlying HR action fail.
"""

import asyncio
import json
import logging
import os
import threading
from typing import Any

import firebase_admin
from firebase_admin import credentials, messaging

from lib.auth import manager_email
from lib.db import db

logger = logging.getLogger(__name__)
APP_NAME = "azo-hr"
_app: firebase_admin.App | None = None
_app_lock = threading.Lock()


def _firebase_app() -> firebase_admin.App | None:
    """Initialize the named Admin SDK app lazily from runtime configuration."""
    global _app
    if _app is not None:
        return _app

    raw_config = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw_config:
        return None

    try:
        service_account = json.loads(raw_config)
        if not isinstance(service_account, dict):
            raise ValueError("service account must be a JSON object")
        with _app_lock:
            if _app is not None:
                return _app
            try:
                _app = firebase_admin.get_app(APP_NAME)
            except ValueError:
                _app = firebase_admin.initialize_app(
                    credentials.Certificate(service_account),
                    name=APP_NAME,
                )
            return _app
    except Exception as exc:
        # Do not log the configuration or the exception text: either could contain secrets.
        logger.error("Firebase Admin initialization failed (%s)", type(exc).__name__)
        return None


def _recipient_query(note: dict[str, Any]) -> dict[str, str] | None:
    audience = note.get("audience")
    if audience == "manager":
        email = manager_email()
        return {"role": "manager", "email": email} if email else None
    if audience == "employee" and note.get("employee_id"):
        return {"role": "employee", "employee_id": str(note["employee_id"])}
    return None


async def send_notification(note: dict[str, Any]) -> None:
    """Send a privacy-preserving push for a persisted in-app notification."""
    app = _firebase_app()
    if app is None:
        return

    query = _recipient_query(note)
    if query is None:
        return

    try:
        tokens = await db.push_tokens.find(query).to_list(500)
    except Exception as exc:
        logger.warning("Could not load Firebase recipients (%s)", type(exc).__name__)
        return

    if query.get("role") == "employee":
        try:
            employee = await db.employees.find_one(
                {"id": query["employee_id"]},
                {"status": 1, "can_login": 1},
            )
        except Exception as exc:
            logger.warning("Could not verify Firebase recipient (%s)", type(exc).__name__)
            return
        if not employee or employee.get("status") != "active" or not employee.get("can_login", True):
            return

    audience = str(note.get("audience") or "")
    title = "مواردي"
    body = (
        "لديك تحديث جديد في لوحة الإدارة."
        if audience == "manager"
        else "لديك إشعار جديد. افتح التطبيق للاطلاع."
    )
    data = {
        "notification_id": str(note.get("id") or ""),
        "kind": str(note.get("kind") or "message"),
        "audience": audience,
    }

    for record in tokens:
        token = record.get("token")
        if not token:
            continue
        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=data,
            token=token,
            android=messaging.AndroidConfig(priority="high"),
        )
        try:
            await asyncio.to_thread(messaging.send, message, app=app)
        except Exception as exc:
            code = str(getattr(exc, "code", "") or "")
            if code in {
                "messaging/invalid-registration-token",
                "messaging/registration-token-not-registered",
            }:
                try:
                    await db.push_tokens.delete_one({"token": token})
                except Exception as cleanup_error:
                    logger.warning(
                        "Could not remove expired Firebase token (%s)",
                        type(cleanup_error).__name__,
                    )
            else:
                logger.warning(
                    "Firebase push delivery failed (%s)",
                    code or type(exc).__name__,
                )
