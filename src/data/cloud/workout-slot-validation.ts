import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft } from './workout-occurrence-plan';
import { WorkoutSchedulingRepository } from './workout-scheduling';

export class WorkoutSlotConflict extends Error {}

type Booking = Pick<LocalWorkoutOccurrenceDraft, 'athleteUserId' | 'coachUserId' | 'format' | 'startsAtUtc' | 'durationMinutes'>;
export function bookingsShareParticipant(a: Booking, b: Booking): boolean {
  const people = (row: Booking) => [row.athleteUserId,
    ...(row.format === 'coached' && row.coachUserId ? [row.coachUserId] : [])];
  return people(a).some(person => people(b).includes(person));
}
export function bookingsOverlap(a: Booking, b: Booking): boolean {
  return bookingsShareParticipant(a, b)
    && Date.parse(a.startsAtUtc) < Date.parse(b.startsAtUtc) + b.durationMinutes * 60_000
    && Date.parse(b.startsAtUtc) < Date.parse(a.startsAtUtc) + a.durationMinutes * 60_000;
}

/* Training and personal-event bookings share one slot validation path. */
type SlotCandidate = Booking & Pick<LocalWorkoutOccurrenceDraft, 'actorUserId'> & { targetOccurrenceId?: string };

/** Dynamic eligibility is evaluated only against the authorized local calendars. */
export async function assertLocalWorkoutSlot(db: MezfitCloudDatabase, draft: SlotCandidate): Promise<void> {
  const scheduling = new WorkoutSchedulingRepository(db, draft.actorUserId);
  // Serialize WebCrypto-backed membership checks within the enclosing transaction.
  const athlete = await scheduling.listCalendar(draft.athleteUserId, true);
  const coach = draft.format === 'coached' && draft.coachUserId
    ? await scheduling.listCalendar(draft.coachUserId, true) : [];
  const rows = [...athlete, ...coach].filter(row => row.id !== draft.targetOccurrenceId);
  if (rows.some(row => bookingsOverlap(draft, row)))
    throw new WorkoutSlotConflict('Это время занято другой записью календаря. Выберите свободное время');
}
