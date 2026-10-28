import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';

/** Shared by planned, program and quick Coach starts; only another athlete's coached booking
 * occupying the actual Start instant requires this cancellation flow.
 * Do not infer a cancellation from a later booking or from a session running long.
 * A different day for the same athlete is a separate, not-yet-implemented flow.
 */
export function currentStartConflicts<T extends Pick<CloudWorkoutOccurrenceRow, 'athleteUserId' | 'coachUserId'> & { id?: string }>(
  selected: T, rows: readonly CloudWorkoutOccurrenceRow[], startedAt: string,
): CloudWorkoutOccurrenceRow[] {
  const instant = Date.parse(startedAt);
  if (!selected.coachUserId || !Number.isFinite(instant)) return [];
  return rows.filter(row => row.id !== selected.id && row.entryKind !== 'personal_event'
    && !row.inactive && row.status === 'scheduled' && !row.cancelledAt && !row.workoutSessionId
    && row.format === 'coached' && row.coachUserId === selected.coachUserId
    && row.athleteUserId !== selected.athleteUserId
    && Date.parse(row.startsAtUtc) <= instant
    && instant < Date.parse(row.startsAtUtc) + row.durationMinutes * 60_000);
}

export class PlannedWorkoutConflict extends Error {
  constructor(readonly occurrences: readonly CloudWorkoutOccurrenceRow[]) {
    super('На это время назначена тренировка другого клиента');
  }
}
