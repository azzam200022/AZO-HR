import { describe, expect, it } from "vitest";
import type { AttendanceRecord } from "./types";
import { findOpenOvernightRecord } from "./overnight-attendance";

function attendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "attendance-1",
    employee_id: "employee-1",
    date: "2026-11-14",
    status: "present",
    is_synthetic: false,
    is_archived: false,
    check_in: "22:00",
    check_in_at: null,
    check_out: "",
    check_out_at: null,
    location_id: "",
    distance_m: null,
    late_minutes: 0,
    away_minutes: 0,
    outside_since: "",
    outside_since_at: "",
    away_intervals: [],
    last_seen: "",
    created_at: "2026-11-14T19:00:00Z",
    ...overrides,
  };
}

describe("findOpenOvernightRecord", () => {
  it("ignores a synthetic absence from the previous shift date", () => {
    const absent = attendance({
      id: "calendar-absence",
      status: "absent",
      is_synthetic: true,
      check_in: "",
    });

    expect(findOpenOvernightRecord([absent], "2026-11-14")).toBeUndefined();
  });

  it("returns a real, open attendance punch from the previous date", () => {
    const openPunch = attendance();

    expect(findOpenOvernightRecord([openPunch], "2026-11-14")).toBe(openPunch);
  });

  it("ignores closed punches and records without a check-in", () => {
    const closed = attendance({ check_out: "06:00" });
    const noCheckIn = attendance({ id: "empty", check_in: "" });

    expect(findOpenOvernightRecord([closed, noCheckIn], "2026-11-14")).toBeUndefined();
  });
});
