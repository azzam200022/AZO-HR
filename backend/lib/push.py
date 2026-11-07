"""FCM and browser Web Push delivery for existing in-app notifications.

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
from pywebpush import WebPushException, webpush

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


def _web_push_config() -> tuple[str, str] | None:
    public_key = os.environ.get("WEB_PUSH_VAPID_PUBLIC_KEY", "").strip()
    private_key = os.environ.get("WEB_PUSH_VAPID_PRIVATE_KEY", "").strip()
    if not public_key or not private_key:
        return None
    return public_key, private_key


def _notification_content(note: dict[str, Any]) -> tuple[str, str, dict[str, str]]:
    audience = str(note.get("audience") or "")
    kind = str(note.get("kind") or "message")
    title_by_kind = {
        "late": "تأخر عن الدوام",
        "left_site": "مغادرة موقع العمل",
        "attendance": "الحضور والانصراف",
        "message": "رسالة جديدة",
        "bonus": "حافز جديد",
        "deduction": "خصم جديد",
        "payroll": "تسوية الراتب",
        "leave_request": "طلب إجازة جديد",
        "leave_status": "تحديث الإجازة",
        "shift_reminder": "تذكير بموعد الدوام",
    }
    title = title_by_kind.get(kind, "مواردي")
    fallback = "لديك تحديث جديد في لوحة الإدارة." if audience == "manager" else "لديك إشعار جديد."
    body = str(note.get("message") or fallback).strip()
    if len(body) > 240:
        body = body[:237].rstrip() + "…"
    data = {
        "notification_id": str(note.get("id") or ""),
        "kind": kind,
        "audience": audience,
    }
    return title, body, data


async def _employee_can_receive_push(query: dict[str, str]) -> bool:
    if query.get("role") != "employee":
        return True
    try:
        employee = await db.employees.find_one(
            {"id": query["employee_id"]},
            {"status": 1, "can_login": 1},
        )
    except Exception as exc:
        logger.warning("Could not verify push recipient (%s)", type(exc).__name__)
        return False
    return bool(
        employee
        and employee.get("status") == "active"
        and employee.get("can_login", True)
    )


async def _send_fcm(
    note: dict[str, Any],
    query: dict[str, str],
    app: firebase_admin.App,
    title: str,
    body: str,
    data: dict[str, str],
) -> None:
    try:
        tokens = await db.push_tokens.find(query).to_list(500)
    except Exception as exc:
        logger.warning("Could not load Firebase recipients (%s)", type(exc).__name__)
        return

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


async def _send_web_push(
    query: dict[str, str],
    note: dict[str, Any],
    config: tuple[str, str],
) -> None:
    try:
        subscriptions = await db.web_push_subscriptions.find(query).to_list(500)
    except Exception as exc:
        logger.warning("Could not load browser push recipients (%s)", type(exc).__name__)
        return

    _, private_key = config
    subject = os.environ.get(
        "WEB_PUSH_VAPID_SUBJECT",
        "https://azzam200022.github.io",
    ).strip()
    notification_id = str(note.get("id") or "")
    payload = {
        "title": "مواردي — إشعار جديد",
        "body": "لديك تحديث جديد. افتح التطبيق للاطلاع على التفاصيل.",
        "tag": f"mawaridi-{notification_id}" if notification_id else "mawaridi",
        "data": {
            "notification_id": notification_id,
            "kind": str(note.get("kind") or "message"),
            "audience": str(note.get("audience") or ""),
        },
    }

    for record in subscriptions:
        subscription = record.get("subscription")
        endpoint = subscription.get("endpoint") if isinstance(subscription, dict) else None
        if not endpoint:
            continue
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info=subscription,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=3600,
            )
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in {404, 410}:
                try:
                    await db.web_push_subscriptions.delete_one({"endpoint": endpoint})
                except Exception as cleanup_error:
                    logger.warning(
                        "Could not remove expired browser push subscription (%s)",
                        type(cleanup_error).__name__,
                    )
            else:
                logger.warning(
                    "Browser push delivery failed (%s)",
                    status or type(exc).__name__,
                )
        except Exception as exc:
            logger.warning("Browser push delivery failed (%s)", type(exc).__name__)


async def send_notification(note: dict[str, Any]) -> None:
    """Send push notifications to registered Android and browser devices."""
    app = _firebase_app()
    web_config = _web_push_config()
    if app is None and web_config is None:
        return

    query = _recipient_query(note)
    if query is None or not await _employee_can_receive_push(query):
        return

    title, body, data = _notification_content(note)
    if app is not None:
        await _send_fcm(note, query, app, title, body, data)
    if web_config is not None:
        await _send_web_push(query, note, web_config)
