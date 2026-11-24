"""Account deletion requests (Google Play account-deletion requirement)."""

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from lib.auth import Principal, require_employee
from lib.db import db
from lib.notify import notify_manager_event

router = APIRouter(tags=["account-deletion"])


class DeletionRequestIn(BaseModel):
    reason: str = Field(default="", max_length=500)


class PublicDeletionRequestIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    contact: str = Field(min_length=3, max_length=160)
    reason: str = Field(default="", max_length=500)


class DeletionRequestOut(BaseModel):
    id: str
    status: str
    created_at: str


async def _save(employee: dict, source: str, contact: str, reason: str) -> DeletionRequestOut:
    record = DeletionRequestOut(
        id=str(uuid.uuid4()),
        status="pending",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    await db.account_deletion_requests.insert_one(
        {
            **record.model_dump(),
            "employee_id": employee["id"],
            "name": employee.get("name", ""),
            "contact": contact,
            "reason": reason,
            "source": source,
        }
    )
    detail = f" — السبب: {reason}" if reason else ""
    await notify_manager_event(
        kind="account_deletion",
        employee=employee,
        message=f"طلب حذف حساب من {employee.get('name') or contact} ({contact}){detail}. احذف الموظف من صفحة الموظفين لإتمام الطلب.",
    )
    return record


@router.get("/me/account-deletion", response_model=DeletionRequestOut | None)
async def my_deletion_request(principal: Principal = Depends(require_employee)):
    doc = await db.account_deletion_requests.find_one(
        {"employee_id": principal.employee_id, "status": "pending"}, sort=[("created_at", -1)]
    )
    return DeletionRequestOut(**doc) if doc else None


@router.post("/me/account-deletion", response_model=DeletionRequestOut, status_code=201)
async def request_my_deletion(
    payload: DeletionRequestIn, principal: Principal = Depends(require_employee)
):
    existing = await db.account_deletion_requests.find_one(
        {"employee_id": principal.employee_id, "status": "pending"}
    )
    if existing:
        return DeletionRequestOut(**existing)
    employee = await db.employees.find_one({"id": principal.employee_id}) or {
        "id": principal.employee_id,
        "name": principal.name,
    }
    contact = employee.get("email") or employee.get("phone") or employee.get("access_code", "")
    return await _save(employee, "app", contact, payload.reason.strip())


@router.post("/public/account-deletion", response_model=DeletionRequestOut, status_code=201)
async def request_public_deletion(payload: PublicDeletionRequestIn):
    contact = payload.contact.strip()
    match = await db.employees.find_one(
        {"$or": [{"email": {"$regex": f"^{re.escape(contact)}$", "$options": "i"}}, {"phone": contact}]},
        {"id": 1, "name": 1},
    ) if contact else None
    employee = {"id": match["id"], "name": match.get("name", "")} if match else {"id": "", "name": payload.name.strip()}
    if match:
        existing = await db.account_deletion_requests.find_one({"employee_id": match["id"], "status": "pending"})
        if existing:
            return DeletionRequestOut(**existing)
    return await _save(employee, "web", contact, payload.reason.strip())
