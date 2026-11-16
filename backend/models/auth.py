"""Auth DTOs. Mirrored by hand in frontend/src/lib/types.ts."""

from typing import Literal
from datetime import datetime

from pydantic import BaseModel, Field


class ManagerLogin(BaseModel):
    email: str
    password: str


class EmployeeLogin(BaseModel):
    access_code: str = ""
    email: str = ""
    password: str = ""
    device_id: str = Field(
        min_length=36,
        max_length=36,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    )


class SessionInfo(BaseModel):
    authenticated: bool
    role: Literal["manager", "employee"] | None = None
    email: str = ""
    name: str = ""
    employee_id: str = ""


class LogoutResult(BaseModel):
    ok: bool


class AccessCodeResult(BaseModel):
    employee_id: str
    access_code: str


class SetPasswordPayload(BaseModel):
    password: str = Field(min_length=6)


class DeviceChangeRequestView(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    device_hint: str
    created_at: datetime


class DeviceChangeDecision(BaseModel):
    id: str
    status: Literal["approved", "rejected"]