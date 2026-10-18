"""Auth DTOs. Mirrored by hand in frontend/src/lib/types.ts."""

from typing import Literal

from pydantic import BaseModel, Field


class ManagerLogin(BaseModel):
    email: str
    password: str


class EmployeeLogin(BaseModel):
    access_code: str = ""
    email: str = ""
    password: str = ""


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