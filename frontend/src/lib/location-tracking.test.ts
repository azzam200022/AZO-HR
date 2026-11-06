import { describe, expect, it } from "vitest";
import type { AttendanceRecord, Employee } from "@/lib/types";
import { getShiftState, getTrackingSummary } from "@/lib/location-tracking";

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "employee-1",
    name: "موظف اختبار",
    job_title: "موظف",
    email: "",
    phone: "",
    base_salary: 0,
    allowances: 0,
    hire_date: "2026-01-01",
    status: "active",
    location_id: "location-1",
    shift_start: "08:00",
    shift_end: "16:00",
    work_days: [0, 1, 2, 3, 4, 5, 6],
    grace_minutes: 5,
    monthly_leave_quota: 2,
    payroll_cycle_start: "",
    access_code: "",
    can_login: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function attendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "attendance-1",
    employee_id: "employee-1",
    date: "2026-11-06",
    status: "present",
    is_synthetic: false,
    is_archived: false,
    check_in: "22:00",
    check_in_at: null,
    check_out: "",
    check_out_at: null,
    location_id: "location-1",
    distance_m: null,
    late_minutes: 0,
    away_minutes: 0,
    outside_since: "",
    outside_since_at: "",
    away_intervals: [],
    last_seen: "23:59",
    created_at: "2026-11-06T19:00:00Z",
    ...overrides,
  };
}

describe("employee shift ordering", () => {
  it("orders a scheduled day shift as upcoming, working, then completed", () => {
    const dayEmployee = employee({
      work_days: [0],
      shift_start: "08:00",
      shift_end: "16:00",
    });

    expect(getShiftState(dayEmployee, "2026-11-02", "07:00")).toBe("upcoming");
    expect(getShiftState(dayEmployee, "2026-11-02", "10:00")).toBe("working");
    expect(getShiftState(dayEmployee, "2026-11-02", "17:00")).toBe("completed");
    expect(getShiftState(dayEmployee, "2026-11-03", "10:00")).toBe("off");
  });

  it("keeps overnight shifts active past midnight and marks them completed after end", () => {
    const nightEmployee = employee({
      work_days: [4],
      shift_start: "22:00",
      shift_end: "06:00",
    });

    expect(getShiftState(nightEmployee, "2026-11-06", "23:00")).toBe("working");
    expect(getShiftState(nightEmployee, "2026-11-07", "02:00")).toBe("working");
    expect(getShiftState(nightEmployee, "2026-11-07", "07:00")).toBe("completed");
  });
});

describe("location tracking freshness", () => {
  it("treats a recent overnight heartbeat as active across midnight", () => {
    const nightEmployee = employee({
      shift_start: "22:00",
      shift_end: "06:00",
    });
    const result = getTrackingSummary(
      nightEmployee,
      "working",
      [attendance()],
      "2026-11-07",
      "00:01",
    );

    expect(result.active).toBe(true);
    expect(result.label).toBe("التتبع يعمل");
  });

  it("reports an old heartbeat as inactive instead of claiming GPS is enabled", () => {
    const result = getTrackingSummary(
      employee(),
      "working",
      [attendance({ date: "2026-11-06", check_in: "08:00", last_seen: "08:00" })],
      "2026-11-06",
      "10:00",
    );

    expect(result.active).toBe(false);
    expect(result.detail).toContain("لا توجد إشارة حديثة");
  });
});
