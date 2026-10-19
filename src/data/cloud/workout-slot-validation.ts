import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft } from './workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { WorkoutSchedulingRepository } from './workout-scheduling';

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

/** Dynamic eligibility is evaluated only against the authorized local calendars. */
export async function assertLocalWorkoutSlot(db: MezfitCloudDatabase, draft: LocalWorkoutOccurrenceDraft,
  acknowledged: readonly (Booking & { id: string; status?: string })[] = []): Promise<void> {
  if (draft.cancelRequested || draft.submissionPending) return;
  const scheduling = new WorkoutSchedulingRepository(db, draft.actorUserId);
  const [athlete, coach, drafts] = await Promise.all([
    scheduling.listCalendar(draft.athleteUserId),
    draft.format === 'coached' && draft.coachUserId ? scheduling.listCalendar(draft.coachUserId) : [],
    new WorkoutOccurrenceDraftRepository(db, draft.actorUserId).list(),
  ]);
  const rows = [...athlete, ...coach, ...acknowledged.filter(row => row.status !== 'cancelled')]
    .filter(row => row.id !== draft.targetOccurrenceId);
  const local = drafts.filter(row => row.id !== draft.id
    && (!draft.targetOccurrenceId || row.targetOccurrenceId !== draft.targetOccurrenceId));
  if ([...rows, ...local].some(row => bookingsOverlap(draft, row)))
    throw new Error('Это время занято другой тренировкой атлета или тренера. Выберите свободное время');
}
