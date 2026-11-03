"""Authentication & authorization primitives.

Scope (deliberately minimal): ONE manager account (the email in MANAGER_EMAIL) plus
employee principals that may only ever reach their OWN records. That is a role layer
(manager vs employee) + object ownership — no tenancy, no policy engine.

The principal is always derived on the server from the session cookie; the client never
sends a role or an employee_id for authorization purposes.
"""

import logging
import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Cookie, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel

from lib.db import db

SESSION_COOKIE = "hr_session"
SESSION_TTL_DAYS = 14

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return pwd_context.verify(raw, hashed)
    except ValueError:
        return False


def manager_email() -> str:
    return (os.environ.get("MANAGER_EMAIL") or "").strip().lower()


async def ensure_manager_account() -> None:
    """Provision the sole manager from runtime configuration, never source code."""
    email = manager_email()
    password = os.environ.get("MANAGER_PASSWORD") or ""
    if not email or not password:
        logger.warning("MANAGER_EMAIL and MANAGER_PASSWORD must be set to provision the manager account")
        return

    await db.users.update_one(
        {"email": email},
        {
            "$set": {"role": "manager", "password_hash": hash_password(password)},
            "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    logger.info("Manager account provisioned from runtime configuration")


def new_access_code() -> str:
    """Short, human-readable employee login code, e.g. MW-4821."""
    return "MW-" + "".join(secrets.choice(string.digits) for _ in range(4))


def new_secret_code(prefix: str = "MW") -> str:
    alphabet = string.ascii_uppercase + string.digits
    return f"{prefix}-" + "".join(secrets.choice(alphabet) for _ in range(5))


class Principal(BaseModel):
    """Server-derived identity for the current request."""

    role: Literal["manager", "employee"]
    email: str = ""
    employee_id: str = ""  # set for employee principals only
    name: str = ""


async def create_session(role: str, *, email: str = "", employee_id: str = "") -> str:
    token = secrets.token_urlsafe(32)
    await db.sessions.insert_one(
        {
            "token": token,
            "role": role,
            "email": email,
            "employee_id": employee_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS),
        }
    )
    return token


async def destroy_session(token: str | None) -> None:
    if token:
        await db.sessions.delete_one({"token": token})


async def _principal_from_token(token: str | None) -> Principal | None:
    """Re-derive the principal from the source of truth on every request, so a deleted
    employee or a revoked login code stops working immediately — not at session expiry."""
    if not token:
        return None
    session = await db.sessions.find_one({"token": token})
    if not session:
        return None

    expires = session.get("expires_at")
    if isinstance(expires, datetime):
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            await db.sessions.delete_one({"token": token})
            return None

    if session["role"] == "manager":
        # The manager identity is pinned to the configured email — a stale session for a
        # changed MANAGER_EMAIL is not a manager any more.
        if (session.get("email") or "").lower() != manager_email():
            return None
        return Principal(role="manager", email=session["email"])

    employee = await db.employees.find_one({"id": session.get("employee_id")})
    if not employee or not employee.get("can_login", True) or employee.get("status") != "active":
        return None
    return Principal(
        role="employee",
        employee_id=employee["id"],
        email=employee.get("email", ""),
        name=employee.get("name", ""),
    )


async def current_principal(hr_session: str | None = Cookie(default=None)) -> Principal:
    """Any authenticated principal. Fail-closed: no valid session → 401."""
    principal = await _principal_from_token(hr_session)
    if not principal:
        raise HTTPException(status_code=401, detail="الجلسة غير صالحة — يرجى تسجيل الدخول")
    return principal


async def optional_principal(hr_session: str | None = Cookie(default=None)) -> Principal | None:
    return await _principal_from_token(hr_session)


async def require_manager(hr_session: str | None = Cookie(default=None)) -> Principal:
    """Manager-only surface: the whole management console."""
    principal = await _principal_from_token(hr_session)
    if not principal:
        raise HTTPException(status_code=401, detail="الجلسة غير صالحة — يرجى تسجيل الدخول")
    if principal.role != "manager":
        raise HTTPException(status_code=403, detail="هذه الصفحة مخصصة لمدير النظام فقط")
    return principal


async def require_employee(hr_session: str | None = Cookie(default=None)) -> Principal:
    """Employee self-service surface. The employee_id comes from the session, never the client."""
    principal = await _principal_from_token(hr_session)
    if not principal:
        raise HTTPException(status_code=401, detail="الجلسة غير صالحة — يرجى تسجيل الدخول")
    if principal.role != "employee":
        raise HTTPException(status_code=403, detail="هذه الخدمة مخصصة لحسابات الموظفين")
    return principal