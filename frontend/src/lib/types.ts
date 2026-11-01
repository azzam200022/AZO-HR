// Hand-written mirrors of the Pydantic models in backend/models/hr.py — nothing infers
// across the HTTP boundary, so when a model changes there, change it here in the same edit.
export type EmployeeStatus = "active" | "inactive";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type LeaveType = "annual" | "sick" | "unpaid";
export type PayrollStatus = "draft" | "paid";

export interface Employee {
  id: string;
  name: string;
  job_title: string;
  email: string;
  phone: string;
  base_salary: number;
  allowances: number;
  hire_date: string;
  status: EmployeeStatus;
  location_id: string; // "" = no geofence restriction
  shift_start: string; // HH:MM — this employee's own working hours
  shift_end: string; // HH:MM — may wrap past midnight (16:00 → 00:00)
  grace_minutes: number; // late grace window
  monthly_leave_quota: number; // leaves allowed per hire-date cycle
  access_code: string; // login code issued by the manager
  can_login: boolean;
  created_at: string;
}

export interface LeaveBalance {
  cycle_start: string;
  cycle_end: string;
  quota: number;
  used: number;
  remaining: number;
}

export interface MonthlyAttendanceReport {
  month: string;
  days_present: number;
  days_complete: number;
  total_minutes: number;
  avg_check_in: string;
  late_days: number;
  total_late_minutes: number;
  total_away_minutes: number;
  on_time_days: number;
  shift_start: string;
  shift_end: string;
  grace_minutes: number;
  records: AttendanceRecord[];
}

export interface EmployeeReport {
  employee: Employee;
  location_name: string;
  attendance: MonthlyAttendanceReport;
  leaves: LeaveRequest[];
  balance: LeaveBalance;
}

export interface SessionInfo {
  authenticated: boolean;
  role: "manager" | "employee" | null;
  email: string;
  name: string;
  employee_id: string;
}

export interface AccessCodeResult {
  employee_id: string;
  access_code: string;
}

export interface LogoutResult {
  ok: boolean;
}

export interface WorkLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  check_in: string; // HH:MM — "" when unknown
  check_out: string; // HH:MM
  location_id: string; // "" when punch had no geofence
  distance_m: number | null;
  late_minutes: number; // minutes late against the employee's shift start
  away_minutes: number; // minutes spent outside the work location during the shift
  outside_since: string; // HH:MM while currently away, "" when inside
  last_seen: string; // HH:MM of the last location heartbeat
  created_at: string;
}

export interface PresenceStatus {
  inside: boolean;
  distance_m: number | null;
  away_minutes: number;
  late_minutes: number;
  total_late_minutes: number;
  tracking: boolean;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  manager_note: string;
  created_at: string;
}

export interface LeaveWithEmployee extends LeaveRequest {
  employee_name: string;
}

export interface PayrollItem {
  id: string;
  employee_id: string;
  month: string; // YYYY-MM
  base_salary: number;
  allowances: number;
  deductions: number;
  net: number;
  status: PayrollStatus;
  created_at: string;
}

export interface TrendPoint {
  date: string;
  present: number;
}

export interface DashboardStats {
  total_employees: number;
  active_employees: number;
  present_today: number;
  pending_leaves: number;
  payroll_month: string;
  payroll_total: number;
  attendance_trend: TrendPoint[];
  leave_breakdown: Record<LeaveStatus, number>;
  recent_leaves: LeaveWithEmployee[];
}

export interface GenerateResult {
  month: string;
  created: number;
}

export interface DeleteResult {
  id: string;
  deleted: boolean;
}

export interface TodayResponse {
  today: string;
  now_hhmm: string;
}

// Arabic label maps
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "سنوية",
  sick: "مرضية",
  unpaid: "بدون راتب",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "معلّق",
  approved: "مقبولة",
  rejected: "مرفوضة",
};

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: "مسوّدة",
  paid: "مدفوع",
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "نشِط",
  inactive: "موقوف",
};