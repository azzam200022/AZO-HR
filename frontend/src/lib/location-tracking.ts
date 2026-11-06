import type { AttendanceRecord, Employee } from "@/lib/types";

export type ShiftState = "working" | "upcoming" | "off" | "completed";
export type TrackingTone = "active" | "warning" | "muted";

export interface TrackingSummary {
  active: boolean;
  label: string;
  detail: string;
  tone: TrackingTone;
}

export interface EmployeeTrackingRow {
  employee: Employee;
  shiftState: ShiftState;
  shiftLabel: string;
  tracking: TrackingSummary;
}

export const TRACKING_FRESHNESS_MINUTES = 3;

const MINUTES_PER_DAY = 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function minutesFromTime(value?: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function previousIsoDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function dateOrdinal(value: string): number | null {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / DAY_MS);
}

function isScheduledOn(employee: Employee, date: string): boolean {
  const ordinal = dateOrdinal(date);
  if (ordinal === null) return true;
  const weekday = (new Date(ordinal * DAY_MS).getUTCDay() + 6) % 7;
  return !employee.work_days?.length || employee.work_days.includes(weekday);
}

export function getShiftState(employee: Employee, today: string, now: string): ShiftState {
  if (employee.status !== "active") return "off";

  const nowMinutes = minutesFromTime(now);
  const startMinutes = minutesFromTime(employee.shift_start) ?? 8 * 60;
  const endMinutes = minutesFromTime(employee.shift_end) ?? 16 * 60;
  if (nowMinutes === null) return "off";

  if (endMinutes > startMinutes) {
    if (!isScheduledOn(employee, today)) return "off";
    if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) return "working";
    return nowMinutes < startMinutes ? "upcoming" : "completed";
  }

  const yesterday = previousIsoDate(today);
  const scheduledToday = isScheduledOn(employee, today);
  const scheduledYesterday = yesterday ? isScheduledOn(employee, yesterday) : false;
  if (nowMinutes >= startMinutes) return scheduledToday ? "working" : "off";
  if (nowMinutes <= endMinutes) {
    if (scheduledYesterday) return "working";
    return scheduledToday ? "upcoming" : "off";
  }
  if (scheduledYesterday) return "completed";
  return scheduledToday ? "upcoming" : "off";
}

export function getShiftLabel(employee: Employee, state: ShiftState): string {
  const start = employee.shift_start || "08:00";
  const end = employee.shift_end || "16:00";
  if (employee.status !== "active") return "حساب الموظف موقوف";
  if (state === "working") return `ضمن فترة الدوام · ${start}–${end}`;
  if (state === "upcoming") return `يبدأ الدوام ${start}`;
  if (state === "completed") return `انتهى الدوام ${end}`;
  return "لا يوجد دوام مجدول الآن";
}

function heartbeatAgeMinutes(
  record: AttendanceRecord,
  employee: Employee,
  today: string,
  now: string,
): number | null {
  const lastSeenMinutes = minutesFromTime(record.last_seen);
  const nowMinutes = minutesFromTime(now);
  const todayOrdinal = dateOrdinal(today);
  const recordOrdinal = dateOrdinal(record.date);
  const endMinutes = minutesFromTime(employee.shift_end) ?? 16 * 60;
  const startMinutes = minutesFromTime(employee.shift_start) ?? 8 * 60;
  if (
    lastSeenMinutes === null ||
    nowMinutes === null ||
    todayOrdinal === null ||
    recordOrdinal === null
  ) {
    return null;
  }

  const overnight = endMinutes <= startMinutes;
  const heartbeatOrdinal =
    recordOrdinal + (overnight && lastSeenMinutes <= endMinutes ? 1 : 0);
  const age =
    (todayOrdinal - heartbeatOrdinal) * MINUTES_PER_DAY + nowMinutes - lastSeenMinutes;
  return age >= 0 ? age : null;
}

export function getTrackingSummary(
  employee: Employee,
  shiftState: ShiftState,
  records: AttendanceRecord[],
  today: string,
  now: string,
): TrackingSummary {
  const sortedRecords = records
    .filter(
      (record) =>
        record.employee_id === employee.id &&
        record.status === "present" &&
        !record.is_synthetic &&
        Boolean(record.check_in),
    )
    .sort((left, right) => right.date.localeCompare(left.date));
  const openRecord = sortedRecords.find((record) => !record.check_out);
  const latestRecord = sortedRecords[0];

  if (employee.status !== "active") {
    return {
      active: false,
      label: "التتبع غير نشط",
      detail: "حساب الموظف موقوف",
      tone: "muted",
    };
  }
  if (shiftState === "completed") {
    return {
      active: false,
      label: "التتبع غير نشط",
      detail: "انتهت فترة الدوام",
      tone: "muted",
    };
  }
  if (shiftState === "upcoming") {
    return {
      active: false,
      label: "التتبع غير نشط",
      detail: `يبدأ الدوام ${employee.shift_start || "08:00"}`,
      tone: "muted",
    };
  }
  if (shiftState === "off") {
    return {
      active: false,
      label: "التتبع غير نشط",
      detail: "خارج جدول الدوام",
      tone: "muted",
    };
  }
  if (!(employee.location_id || openRecord?.location_id || latestRecord?.location_id)) {
    return {
      active: false,
      label: "التتبع غير نشط",
      detail: "لا يوجد موقع عمل مرتبط",
      tone: "warning",
    };
  }
  if (!openRecord) {
    return {
      active: false,
      label: "التتبع غير نشط",
      detail: latestRecord?.check_out ? "سُجّل الانصراف" : "لم يسجل الحضور",
      tone: "warning",
    };
  }

  const age = heartbeatAgeMinutes(openRecord, employee, today, now);
  if (age !== null && age <= TRACKING_FRESHNESS_MINUTES) {
    return {
      active: true,
      label: "التتبع يعمل",
      detail: `آخر تحديث ${openRecord.last_seen}`,
      tone: "active",
    };
  }

  return {
    active: false,
    label: "التتبع غير نشط",
    detail: openRecord.last_seen
      ? `لا توجد إشارة حديثة · آخر تحديث ${openRecord.last_seen}`
      : "لم يصل تحديث للموقع",
    tone: "warning",
  };
}
