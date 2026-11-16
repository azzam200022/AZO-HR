import { describe, expect, it } from "vitest";
import { leaveRequestDates } from "./leave-date-range";

describe("leaveRequestDates", () => {
  it("sends one selected date as both endpoints for a daily leave", () => {
    expect(
      leaveRequestDates("single", "2026-11-20", "2026-11-18", "2026-11-22"),
    ).toEqual({ start_date: "2026-11-20", end_date: "2026-11-20" });
  });

  it("preserves the selected range for a multi-day leave", () => {
    expect(
      leaveRequestDates("range", "2026-11-20", "2026-11-18", "2026-11-22"),
    ).toEqual({ start_date: "2026-11-18", end_date: "2026-11-22" });
  });
});
