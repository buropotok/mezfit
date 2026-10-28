/** Actual execution interval; minimum visual height belongs to the schedule. */
export function sessionTiming(session: { startedAt: string; completedAt: string | null }, now: number) {
  const start = Date.parse(session.startedAt);
  const end = session.completedAt ? Date.parse(session.completedAt) : Math.max(start, now);
  return { startsAtUtc: session.startedAt, endsAtUtc: new Date(end).toISOString(),
    durationMinutes: Math.max(0, (end - start) / 60_000) };
}
