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
  access_code: string; // login code issued by the manager
  can_login: boolean;
  created_at: string;
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
  created_at: string;
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