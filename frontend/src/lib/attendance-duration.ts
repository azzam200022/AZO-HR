export interface AwayTimeInterval {
  left_at: string;
  counting_started_at?: string | null;
  returned_at?: string;
  closed_at?: string;
}

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Seconds actually spent at work, excluding completed and currently open departures. */
export function onsiteDurationSeconds(
  startMs: number,
  endMs: number,
  intervals: readonly AwayTimeInterval[] = [],
  outsideSinceAt = "",
): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  const openStartMs = timestamp(outsideSinceAt);
  let awayMs = 0;
  let hasOpenInterval = false;

  for (const interval of intervals) {
    const countingStartMs =
      interval.counting_started_at === ""
        ? null
        : timestamp(interval.counting_started_at ?? interval.left_at);
    if (countingStartMs === null) continue;

    let rightMs = timestamp(interval.returned_at) ?? timestamp(interval.closed_at);
    if (rightMs === null && openStartMs === countingStartMs) {
      rightMs = endMs;
      hasOpenInterval = true;
    }

    if (openStartMs === countingStartMs) hasOpenInterval = true;
    if (rightMs === null) continue;

    const overlapStart = Math.max(startMs, countingStartMs);
    const overlapEnd = Math.min(endMs, rightMs);
    awayMs += Math.max(0, overlapEnd - overlapStart);
  }

  // Older attendance records may have the open departure timestamp but no interval row.
  if (openStartMs !== null && !hasOpenInterval) {
    awayMs += Math.max(0, endMs - Math.max(startMs, openStartMs));
  }

  return Math.max(0, Math.floor((endMs - startMs - awayMs) / 1000));
}
