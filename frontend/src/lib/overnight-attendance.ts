import type { AttendanceRecord } from "./types";

export function findOpenOvernightRecord(
  records: AttendanceRecord[],
  previousDate: string,
): AttendanceRecord | undefined {
  return records.find(
    (record) =>
      record.date === previousDate &&
      record.status === "present" &&
      !record.is_synthetic &&
      Boolean(record.check_in) &&
      !record.check_out,
  );
}
