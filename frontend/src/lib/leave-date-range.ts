export type LeaveDuration = "single" | "range";

export function leaveRequestDates(
  duration: LeaveDuration,
  singleDate: string,
  startDate: string,
  endDate: string,
): { start_date: string; end_date: string } {
  return duration === "single"
    ? { start_date: singleDate, end_date: singleDate }
    : { start_date: startDate, end_date: endDate };
}
