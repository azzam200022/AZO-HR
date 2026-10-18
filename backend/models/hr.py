"""Pydantic v2 models for the HR domain.

Mirrored by hand in frontend/src/lib/types.ts — when a model changes here,
change its TS interface in the same edit.
"""

import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Employee(BaseModel):
    id: str = Field(default_factory=_uuid)
    name: str
    job_title: str
    email: str = ""
    phone: str = ""
    base_salary: float = Field(default=0, ge=0)
    allowances: float = Field(default=0, ge=0)
    hire_date: str
    status: Literal["active", "inactive"] = "active"
    location_id: str = ""  # assigned work location; "" = no geofence
    access_code: str = ""  # login code issued by the manager (e.g. MW-4821)
    can_login: bool = True
    created_at: datetime = Field(default_factory=utcnow)


class EmployeeCreate(BaseModel):
    name: str
    job_title: str
    email: str = ""
    phone: str = ""
    base_salary: float = Field(ge=0)
    allowances: float = Field(default=0, ge=0)
    hire_date: str
    status: Literal["active", "inactive"] = "active"
    location_id: str = ""

    @field_validator("hire_date")
    @classmethod
    def _hire_date_format(cls, v: str) -> str:
        if not DATE_RE.match(v):
            raise ValueError("hire_date must be YYYY-MM-DD")
        return v


class EmployeeUpdate(BaseModel):
    name: str | None = None
    job_title: str | None = None
    email: str | None = None
    phone: str | None = None
    base_salary: float | None = Field(default=None, ge=0)
    allowances: float | None = Field(default=None, ge=0)
    hire_date: str | None = None
    status: Literal["active", "inactive"] | None = None
    location_id: str | None = None
    can_login: bool | None = None


class AttendanceRecord(BaseModel):
    id: str = Field(default_factory=_uuid)
    employee_id: str
    date: str  # YYYY-MM-DD
    check_in: str = ""  # HH:MM — empty when unknown
    check_out: str = ""  # HH:MM
    location_id: str = ""  # work location the punch was verified against ("" = none)
    distance_m: float | None = None  # metres from the location at check-in
    created_at: datetime = Field(default_factory=utcnow)


class AttendanceCreate(BaseModel):
    employee_id: str
    date: str | None = None  # defaults to server today
    check_in: str = ""
    check_out: str = ""


class AttendanceUpdate(BaseModel):
    date: str | None = None
    check_in: str | None = None
    check_out: str | None = None


class CheckPunch(BaseModel):
    employee_id: str
    lat: float | None = None
    lng: float | None = None


class SelfPunch(BaseModel):
    """Employee self check-in: the identity comes from the session, only the GPS fix is sent."""

    lat: float | None = None
    lng: float | None = None


class LeaveRequest(BaseModel):
    id: str = Field(default_factory=_uuid)
    employee_id: str
    leave_type: Literal["annual", "sick", "unpaid"] = "annual"
    start_date: str
    end_date: str
    reason: str = ""
    status: Literal["pending", "approved", "rejected"] = "pending"
    manager_note: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class LeaveCreate(BaseModel):
    employee_id: str
    leave_type: Literal["annual", "sick", "unpaid"] = "annual"
    start_date: str
    end_date: str
    reason: str = ""

    @field_validator("start_date", "end_date")
    @classmethod
    def _date_format(cls, v: str) -> str:
        if not DATE_RE.match(v):
            raise ValueError("dates must be YYYY-MM-DD")
        return v


class SelfLeaveCreate(BaseModel):
    """Employee-submitted leave: no employee_id — the session decides whose leave this is."""

    leave_type: Literal["annual", "sick", "unpaid"] = "annual"
    start_date: str
    end_date: str
    reason: str = ""

    @field_validator("start_date", "end_date")
    @classmethod
    def _date_format(cls, v: str) -> str:
        if not DATE_RE.match(v):
            raise ValueError("dates must be YYYY-MM-DD")
        return v


class LeaveUpdate(BaseModel):
    status: Literal["approved", "rejected"] | None = None
    manager_note: str | None = None


class PayrollItem(BaseModel):
    id: str = Field(default_factory=_uuid)
    employee_id: str
    month: str  # YYYY-MM
    base_salary: float = Field(default=0, ge=0)
    allowances: float = Field(default=0, ge=0)
    deductions: float = Field(default=0, ge=0)
    net: float = Field(default=0, ge=0)
    status: Literal["draft", "paid"] = "draft"
    created_at: datetime = Field(default_factory=utcnow)


class PayrollGenerate(BaseModel):
    month: str

    @field_validator("month")
    @classmethod
    def _month_format(cls, v: str) -> str:
        if not MONTH_RE.match(v):
            raise ValueError("month must be YYYY-MM")
        return v


class PayrollUpdate(BaseModel):
    allowances: float | None = Field(default=None, ge=0)
    deductions: float | None = Field(default=None, ge=0)
    status: Literal["draft", "paid"] | None = None


class GenerateResult(BaseModel):
    month: str
    created: int


class WorkLocation(BaseModel):
    id: str = Field(default_factory=_uuid)
    name: str
    latitude: float
    longitude: float
    radius_m: int = Field(default=150, ge=10)
    created_at: datetime = Field(default_factory=utcnow)


class WorkLocationCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radius_m: int = Field(default=150, ge=10)


class WorkLocationUpdate(BaseModel):
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_m: int | None = Field(default=None, ge=10)


class DeleteResult(BaseModel):
    id: str
    deleted: bool


class TodayResponse(BaseModel):
    today: str
    now_hhmm: str


class TrendPoint(BaseModel):
    date: str
    present: int


class LeaveWithEmployee(LeaveRequest):
    employee_name: str = ""


class DashboardStats(BaseModel):
    total_employees: int
    active_employees: int
    present_today: int
    pending_leaves: int
    payroll_month: str
    payroll_total: float
    attendance_trend: list[TrendPoint]
    leave_breakdown: dict[str, int]
    recent_leaves: list[LeaveWithEmployee]