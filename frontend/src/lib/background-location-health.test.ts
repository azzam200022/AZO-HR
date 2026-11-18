import { describe, expect, it } from "vitest";
import { hasRecentBackgroundHeartbeat } from "@/lib/background-location-health";

describe("background location heartbeat freshness", () => {
  it("accepts a recent native location sync", () => {
    expect(hasRecentBackgroundHeartbeat(940_000, 1_000_000)).toBe(true);
  });

  it("marks a stalled native location sync stale", () => {
    expect(hasRecentBackgroundHeartbeat(909_999, 1_000_000)).toBe(false);
    expect(hasRecentBackgroundHeartbeat(0, 1_000_000)).toBe(false);
    expect(hasRecentBackgroundHeartbeat(1_000_001, 1_000_000)).toBe(false);
  });
});
