/** Actual execution interval. A one-minute minimum is visual geometry only. */
export function sessionTiming(session: { startedAt: string; completedAt: string | null }, now: number) {
  const start = Date.parse(session.startedAt);
  const end = session.completedAt ? Date.parse(session.completedAt) : Math.max(start, now);
  return { startsAtUtc: session.startedAt, endsAtUtc: new Date(end).toISOString(),
    durationMinutes: Math.max(1, (end - start) / 60_000) };
}
