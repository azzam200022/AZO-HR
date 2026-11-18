import { describe, expect, it } from "vitest";
import { onsiteDurationSeconds } from "./attendance-duration";
import { durationLabel } from "./format";

const start = Date.parse("2026-11-04T09:00:00+03:00");
const end = Date.parse("2026-11-04T10:00:00+03:00");

describe("onsiteDurationSeconds", () => {
  it("counts the full interval when there are no departures", () => {
    expect(onsiteDurationSeconds(start, end)).toBe(60 * 60);
  });

  it("subtracts the exact seconds spent away after a return", () => {
    expect(
      onsiteDurationSeconds(start, end, [
        {
          left_at: "2026-11-04T09:10:00+03:00",
          returned_at: "2026-11-04T09:20:30+03:00",
        },
      ]),
    ).toBe(60 * 60 - 10 * 60 - 30);
  });

  it("freezes at the start of an open departure", () => {
    const leftAt = "2026-11-04T09:10:00+03:00";
    expect(
      onsiteDurationSeconds(
        start,
        end,
        [{ left_at: leftAt }],
        leftAt,
      ),
    ).toBe(10 * 60);
  });

  it("does not pause the timer while a departure is pending grace", () => {
    expect(
      onsiteDurationSeconds(
        start,
        end,
        [
          {
            left_at: "2026-11-04T09:10:00+03:00",
            counting_started_at: "",
          },
        ],
        "",
      ),
    ).toBe(60 * 60);
  });

  it("starts excluding away time at the grace deadline", () => {
    expect(
      onsiteDurationSeconds(start, end, [
        {
          left_at: "2026-11-04T09:10:00+03:00",
          counting_started_at: "2026-11-04T09:11:00+03:00",
          returned_at: "2026-11-04T09:20:00+03:00",
        },
      ]),
    ).toBe(60 * 60 - 9 * 60);
  });

  it("freezes an open interval at the grace deadline", () => {
    const graceEnd = "2026-11-04T09:11:00+03:00";
    expect(
      onsiteDurationSeconds(
        start,
        end,
        [
          {
            left_at: "2026-11-04T09:10:00+03:00",
            counting_started_at: graceEnd,
          },
        ],
        graceEnd,
      ),
    ).toBe(11 * 60);
  });

  it("uses the open departure timestamp when older records lack interval rows", () => {
    expect(
      onsiteDurationSeconds(
        start,
        end,
        [],
        "2026-11-04T09:10:00+03:00",
      ),
    ).toBe(10 * 60);
  });

  it("clamps departures to the attendance period", () => {
    expect(
      onsiteDurationSeconds(start, end, [
        {
          left_at: "2026-11-04T08:55:00+03:00",
          closed_at: "2026-11-04T10:05:00+03:00",
        },
      ]),
    ).toBe(0);
  });

  it("shows net onsite minutes in attendance summaries", () => {
    expect(durationLabel("08:00", "16:00", 30)).toBe("7س 30د");
    expect(durationLabel("22:00", "06:00", 90)).toBe("6س 30د");
  });
});
