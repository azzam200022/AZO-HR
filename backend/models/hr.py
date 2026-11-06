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


def _validate_work_days(value: list[int] | None) -> list[int] | None:
    if value is None:
        return None
    if not value:
        raise ValueError("work_days must include at least one weekday")
    if any(day not in range(7) for day in value):
        raise ValueError("work_days values must be weekdays from 0 (Monday) to 6 (Sunday)")
    if len(set(value)) != len(value):
        raise ValueError("work_days cannot contain duplicate weekdays")
    return sorted(value)


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
    shift_start: str = "08:00"  # HH:MM — this employee's own working hours
    shift_end: str = "16:00"  # HH:MM — may wrap past midnight (e.g. 16:00 → 00:00)
    work_days: list[int] = Field(
        default_factory=lambda: list(range(7)), min_length=1, max_length=7
    )
    grace_minutes: int = Field(default=5, ge=0)  # late grace window
    monthly_leave_quota: int = Field(default=2, ge=0)  # leaves allowed per hire-date cycle
    payroll_cycle_start: str = ""  # custom cycle anchor; "" = use hire_date
    access_code: str = ""  # login code issued by the manager (e.g. MW-4821)
    can_login: bool = True
    created_at: datetime = Field(default_factory=utcnow)

    @field_validator("work_days")
    @classmethod
    def _work_days_valid(cls, value: list[int]) -> list[int]:
        return _validate_work_days(value)  # type: ignore[return-value]


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
    shift_start: str = "08:00"
    shift_end: str = "16:00"
    work_days: list[int] = Field(
        default_factory=lambda: list(range(7)), min_length=1, max_length=7
    )
    grace_minutes: int = Field(default=5, ge=0)
    monthly_leave_quota: int = Field(default=2, ge=0)
    payroll_cycle_start: str = ""

    @field_validator("work_days")
    @classmethod
    def _work_days_valid(cls, value: list[int]) -> list[int]:
        return _validate_work_days(value)  # type: ignore[return-value]

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
    shift_start: str | None = None
    shift_end: str | None = None
    work_days: list[int] | None = Field(default=None, min_length=1, max_length=7)
    grace_minutes: int | None = Field(default=None, ge=0)
    monthly_leave_quota: int | None = Field(default=None, ge=0)
    payroll_cycle_start: str | None = None
    can_login: bool | None = None

    @field_validator("work_days")
    @classmethod
    def _work_days_valid(cls, value: list[int] | None) -> list[int] | None:
        return _validate_work_days(value)


class AwayInterval(BaseModel):
    """A geofence departure and return, not a full movement path."""

    left_at: str
    left_lat: float | None = None
    left_lng: float | None = None
    left_distance_m: float | None = None
    left_accuracy_m: float | None = None
    returned_at: str = ""
    return_lat: float | None = None
    return_lng: float | None = None
    return_distance_m: float | None = None
    return_accuracy_m: float | None = None
    closed_at: str = ""
    ended_by: Literal["return", "shift_end", "check_out", ""] = ""
    minutes: int = 0


class AttendanceRecord(BaseModel):
    id: str = Field(default_factory=_uuid)
    employee_id: str
    date: str  # YYYY-MM-DD
    status: Literal["present", "absent", "leave", "holiday"] = "present"
    is_synthetic: bool = False  # derived daily status; never persisted as an attendance punch
    is_archived: bool = False  # response-only marker for settled attendance records
    check_in: str = ""  # HH:MM — empty when unknown
    check_in_at: datetime | None = None  # precise UTC instant for the live timer
    check_out: str = ""  # HH:MM
    check_out_at: datetime | None = None  # precise local-zone instant for historical replay
    location_id: str = ""  # work location the punch was verified against ("" = none)
    distance_m: float | None = None  # metres from the location at check-in
    late_minutes: int = 0  # minutes late against the employee's shift start
    away_minutes: int = 0  # minutes spent outside the work location during the shift
    outside_since: str = ""  # HH:MM when the employee was last seen outside ("" = inside)
    away_intervals: list[AwayInterval] = Field(default_factory=list)
    last_seen: str = ""  # HH:MM of the last location heartbeat
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


class PresenceLocationSample(BaseModel):
    """One locally queued Android location fix; identity is checked against the session."""

    event_id: str = Field(min_length=1, max_length=80)
    employee_id: str = Field(min_length=1, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    observed_at_ms: int = Field(gt=0)
    accuracy_m: float | None = Field(default=None, ge=0, le=10000)


class PresenceLocationBatch(BaseModel):
    samples: list[PresenceLocationSample] = Field(min_length=1, max_length=100)


class PresenceLocationBatchResult(BaseModel):
    acknowledged_ids: list[str]
    processed: int
    ignored: int
    checked_out: bool = False


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
    deductions: float = Field(default=0, ge=0)  # manual deductions set by the manager
    late_minutes: int = 0  # lateness billed this cycle
    away_minutes: int = 0  # minutes spent outside the work site during shifts
    late_deduction: float = Field(default=0, ge=0)  # auto deduction for the two above
    absence_days: int = 0  # completed scheduled workdays with no attendance or approved leave
    absence_deduction: float = Field(default=0, ge=0)
    bonus_total: float = Field(default=0, ge=0)  # manual bonuses in this cycle
    adjustment_deductions: float = Field(default=0, ge=0)  # manual deductions in this cycle
    cycle_start: str = ""  # hire-date anchored cycle this payslip covers
    cycle_end: str = ""
    archived_days: int = 0  # attendance records archived when it was paid
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
    updated: int = 0


class Notification(BaseModel):
    id: str = Field(default_factory=_uuid)
    kind: Literal[
        "late",
        "left_site",
        "message",
        "bonus",
        "deduction",
        "attendance",
        "payroll",
        "leave_request",
        "leave_status",
        "shift_reminder",
    ]
    audience: Literal["manager", "employee"] = "manager"
    employee_id: str
    employee_name: str = ""
    date: str = ""  # YYYY-MM-DD
    at_time: str = ""  # HH:MM
    minutes: int = 0
    message: str = ""
    read: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class Message(BaseModel):
    id: str = Field(default_factory=_uuid)
    thread: Literal["direct", "group"] = "direct"
    employee_id: str = ""  # the employee side of a private thread; "" for the team channel
    sender: Literal["manager", "employee"]
    sender_name: str = ""
    body: str = Field(min_length=1, max_length=2000)
    read_by_manager: bool = False
    read_by_employee: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class MessageSend(BaseModel):
    thread: Literal["direct", "group"] = "direct"
    employee_id: str = ""
    body: str = ""


class MessageThread(BaseModel):
    thread: Literal["direct", "group"]
    employee_id: str = ""
    name: str
    job_title: str = ""
    messages: int = 0
    unread: int = 0
    last_body: str = ""
    last_at: str = ""


class BroadcastResult(BaseModel):
    sent: int


class Adjustment(BaseModel):
    """A manual bonus or deduction. `reason` is mandatory by design — money never moves
    without a stated justification the employee can read on their payslip."""

    id: str = Field(default_factory=_uuid)
    employee_id: str
    employee_name: str = ""
    kind: Literal["bonus", "deduction"]
    amount: float = Field(gt=0)
    reason: str = Field(min_length=1, max_length=300)
    date: str = ""  # YYYY-MM-DD — decides which cycle it lands in
    cycle_start: str = ""
    cycle_end: str = ""
    settled: bool = False  # locked once its payroll item is paid
    created_at: datetime = Field(default_factory=utcnow)


class AdjustmentCreate(BaseModel):
    employee_id: str
    kind: Literal["bonus", "deduction"]
    amount: float = Field(gt=0)
    reason: str = ""
    date: str = ""


class CycleInfo(BaseModel):
    """The employee's current (open) cycle."""

    anchor: str  # date the cycles count from
    cycle_start: str
    cycle_end: str
    label: str  # YYYY-MM the cycle starts in
    settled: bool = False  # True once this cycle's payroll was paid


class NotificationSummary(BaseModel):
    unread: int
    total: int


class MarkAllResult(BaseModel):
    updated: int


class DisciplineRow(BaseModel):
    employee_id: str
    name: str
    job_title: str = ""
    shift_start: str = "08:00"
    shift_end: str = "16:00"
    cycle_start: str = ""
    cycle_end: str = ""
    days_present: int = 0
    late_days: int = 0
    on_time_days: int = 0
    late_minutes: int = 0
    away_minutes: int = 0
    total_late_minutes: int = 0
    avg_late_minutes: int = 0
    deduction: float = 0
    score: int = 0  # 0-100 punctuality score
    rank: int = 0


class DisciplineReport(BaseModel):
    month: str
    rows: list[DisciplineRow] = []
    employees: int = 0
    total_late_minutes: int = 0
    total_deduction: float = 0


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


class LeaveBalance(BaseModel):
    """Quota state for the hire-date-anchored cycle that contains today."""

    cycle_start: str
    cycle_end: str
    quota: int
    used: int
    remaining: int


class MonthlyAttendanceReport(BaseModel):
    month: str  # YYYY-MM
    cycle_start: str = ""  # hire-date anchored cycle the report covers
    cycle_end: str = ""
    days_present: int
    days_complete: int  # both punches recorded
    total_minutes: int
    avg_check_in: str = ""
    late_days: int = 0
    total_late_minutes: int = 0
    total_away_minutes: int = 0
    on_time_days: int = 0
    shift_start: str = "08:00"
    shift_end: str = "16:00"
    grace_minutes: int = 5
    records: list["AttendanceRecord"] = []


class EmployeeReport(BaseModel):
    """Profile report — the same payload the employee sees about themself and the manager
    sees about that employee."""

    employee: "Employee"
    location_name: str = ""
    attendance: MonthlyAttendanceReport
    leaves: list["LeaveRequest"] = []
    balance: LeaveBalance


class PresenceStatus(BaseModel):
    """Live geofence state for the open punch of the day."""

    inside: bool
    distance_m: float | None = None
    away_minutes: int = 0
    late_minutes: int = 0
    total_late_minutes: int = 0
    tracking: bool = False  # false when the employee has no assigned work location
    checked_out: bool = False  # true when an after-shift departure closed the attendance record


class DeleteResult(BaseModel):
    id: str
    deleted: bool


class TodayResponse(BaseModel):
    today: str
    now_hhmm: str
    now_utc: datetime


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