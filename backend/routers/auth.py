from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from lib.auth import (
    SESSION_COOKIE,
    SESSION_TTL_DAYS,
    Principal,
    create_session,
    current_principal,
    destroy_session,
    manager_email,
    optional_principal,
    verify_password,
)
from lib.db import db
from models.auth import EmployeeLogin, LogoutResult, ManagerLogin, SessionInfo

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_MANAGER = "البريد الإلكتروني أو كلمة المرور غير صحيحة"
INVALID_EMPLOYEE = "رمز الدخول غير صحيح أو تم تعطيله"


class PushTokenRequest(BaseModel):
    token: str = Field(min_length=20, max_length=4096)


def _set_cookie(response: Response, token: str, origin: str | None) -> None:
    # Capacitor and the GitHub Pages web app call the API cross-site, so those
    # exact trusted origins need SameSite=None for credentialed browser requests.
    # The cookie remains Secure and HttpOnly; all other browser clients keep Lax.
    cross_site_origins = {
        "https://localhost",
        "https://azzam200022.github.io",
    }
    same_site = "none" if origin in cross_site_origins else "lax"
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite=same_site,
        secure=True,
        max_age=SESSION_TTL_DAYS * 24 * 3600,
        path="/",
    )


@router.post("/push-token")
async def register_push_token(
    payload: PushTokenRequest,
    principal: Principal = Depends(current_principal),
):
    """Bind this device's FCM token to the identity in its authenticated session."""
    now = datetime.now(timezone.utc)
    await db.push_tokens.update_one(
        {"token": payload.token},
        {
            "$set": {
                "role": principal.role,
                "email": principal.email,
                "employee_id": principal.employee_id if principal.role == "employee" else "",
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {"ok": True}


@router.post("/push-token/unregister")
async def unregister_push_token(
    payload: PushTokenRequest,
    principal: Principal = Depends(current_principal),
):
    """Remove only this signed-in identity's device token."""
    query: dict = {"token": payload.token, "role": principal.role}
    if principal.role == "employee":
        query["employee_id"] = principal.employee_id
    else:
        query["email"] = principal.email
    result = await db.push_tokens.delete_one(query)
    return {"ok": True, "removed": result.deleted_count > 0}


@router.post("/manager-login", response_model=SessionInfo)
async def manager_login(payload: ManagerLogin, response: Response, request: Request):
    email = payload.email.strip().lower()
    account = await db.users.find_one({"email": email, "role": "manager"})
    # Only the configured manager email may ever hold the manager role.
    if not account or email != manager_email() or not verify_password(payload.password, account.get("password_hash", "")):
        raise HTTPException(status_code=401, detail=INVALID_MANAGER)
    token = await create_session("manager", email=email)
    _set_cookie(response, token, request.headers.get("origin"))
    return SessionInfo(authenticated=True, role="manager", email=email, name="مدير النظام")


@router.post("/employee-login", response_model=SessionInfo)
async def employee_login(payload: EmployeeLogin, response: Response, request: Request):
    """Employees sign in with the access code the manager issued, or with their email +
    password when the manager has set one."""
    employee = None
    if payload.access_code:
        code = payload.access_code.strip().upper()
        employee = await db.employees.find_one({"access_code": code})
    elif payload.email and payload.password:
        found = await db.employees.find_one({"email": payload.email.strip().lower()})
        if found and verify_password(payload.password, found.get("password_hash", "")):
            employee = found
    else:
        raise HTTPException(status_code=400, detail="أدخل رمز الدخول أو البريد وكلمة المرور")

    if not employee:
        raise HTTPException(status_code=401, detail=INVALID_EMPLOYEE)
    if not employee.get("can_login", True):
        raise HTTPException(status_code=403, detail="تم تعطيل دخول هذا الحساب — راجع مدير النظام")
    if employee.get("status") != "active":
        raise HTTPException(status_code=403, detail="حساب الموظف موقوف — راجع مدير النظام")

    token = await create_session("employee", email=employee.get("email", ""), employee_id=employee["id"])
    _set_cookie(response, token, request.headers.get("origin"))
    return SessionInfo(
        authenticated=True,
        role="employee",
        email=employee.get("email", ""),
        name=employee.get("name", ""),
        employee_id=employee["id"],
    )


@router.get("/me", response_model=SessionInfo)
async def whoami(principal: Principal | None = Depends(optional_principal)):
    """Unauthenticated callers get authenticated=false (200) — the frontend uses this to
    decide between the login screen and the app shell."""
    if not principal:
        return SessionInfo(authenticated=False, role=None)
    return SessionInfo(
        authenticated=True,
        role=principal.role,
        email=principal.email,
        name=principal.name or ("مدير النظام" if principal.role == "manager" else ""),
        employee_id=principal.employee_id,
    )


@router.post("/logout", response_model=LogoutResult)
async def logout(response: Response, hr_session: str | None = Cookie(default=None)):
    await destroy_session(hr_session)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return LogoutResult(ok=True)