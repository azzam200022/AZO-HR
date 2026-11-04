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
  work_days: number[]; // Python weekdays: Monday=0 through Sunday=6
  grace_minutes: number; // late grace window
  monthly_leave_quota: number; // leaves allowed per hire-date cycle
  payroll_cycle_start: string; // custom cycle anchor; "" = use hire_date
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
  cycle_start: string;
  cycle_end: string;
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
  month: string; // YYYY-MM the cycle starts in
  base_salary: number;
  allowances: number;
  deductions: number; // manual deductions
  late_minutes: number;
  away_minutes: number;
  late_deduction: number; // auto deduction for lateness + time away
  bonus_total: number; // manual bonuses inside the cycle
  adjustment_deductions: number; // manual deductions inside the cycle
  cycle_start: string;
  cycle_end: string;
  archived_days: number; // attendance days archived when paid
  net: number;
  status: PayrollStatus;
  created_at: string;
}

export interface Adjustment {
  id: string;
  employee_id: string;
  employee_name: string;
  kind: "bonus" | "deduction";
  amount: number;
  reason: string;
  date: string;
  cycle_start: string;
  cycle_end: string;
  settled: boolean;
  created_at: string;
}

export interface AppNotification {
  id: string;
  kind: "late" | "left_site" | "message";
  audience: "manager" | "employee";
  employee_id: string;
  employee_name: string;
  date: string;
  at_time: string;
  minutes: number;
  message: string;
  read: boolean;
  created_at: string;
}

export interface Message {
  id: string;
  thread: "direct" | "group";
  employee_id: string;
  sender: "manager" | "employee";
  sender_name: string;
  body: string;
  read_by_manager: boolean;
  read_by_employee: boolean;
  created_at: string;
}

export interface MessageThread {
  thread: "direct" | "group";
  employee_id: string;
  name: string;
  job_title: string;
  messages: number;
  unread: number;
  last_body: string;
  last_at: string;
}

export interface BroadcastResult {
  sent: number;
}

export interface MarkAllResult {
  updated: number;
}

export interface NotificationSummary {
  unread: number;
  total: number;
}

export interface DisciplineRow {
  employee_id: string;
  name: string;
  job_title: string;
  shift_start: string;
  shift_end: string;
  cycle_start: string;
  cycle_end: string;
  days_present: number;
  late_days: number;
  on_time_days: number;
  late_minutes: number;
  away_minutes: number;
  total_late_minutes: number;
  avg_late_minutes: number;
  deduction: number;
  score: number;
  rank: number;
}

export interface DisciplineReport {
  month: string;
  rows: DisciplineRow[];
  employees: number;
  total_late_minutes: number;
  total_deduction: number;
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
  updated: number;
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