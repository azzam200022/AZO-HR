export const BACKGROUND_LOCATION_FRESHNESS_MS = 90_000;

export function hasRecentBackgroundHeartbeat(
  heartbeatAtMs?: number | null,
  nowMs = Date.now(),
): boolean {
  if (
    typeof heartbeatAtMs !== "number" ||
    !Number.isFinite(heartbeatAtMs) ||
    heartbeatAtMs <= 0 ||
    heartbeatAtMs > nowMs
  ) {
    return false;
  }
  return nowMs - heartbeatAtMs <= BACKGROUND_LOCATION_FRESHNESS_MS;
}
