import type { MezfitCloudDatabase } from './database';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import { assertLocalWorkoutSlot } from './workout-slot-validation';
import { validateScheduleTiming } from './workout-scheduling-time';
import { isWorkoutOccurrencePlan } from './workout-occurrence-plan';

/**
 * A personal event books its owner's time in workoutOccurrences without becoming
 * a workout. The PLAN-shaped metadata container is never used to start a session.
 * A personal event is stored only in the authenticated user's personal realm.
 * Clients cannot see the coach's private busy intervals when scheduling coached
 * workouts; busy-only sharing across realms requires a separate product decision.
 */
export interface PersonalEventInput {
  title: string;
  notes: string | null;
  startsAtUtc: string;
  durationMinutes: number;
}

export function isPersonalEvent(row: CloudWorkoutOccurrenceRow): boolean {
  return row.entryKind === 'personal_event';
}

function validateEvent(input: PersonalEventInput): PersonalEventInput {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120) throw new Error('Название события должно содержать от 1 до 120 символов');
  if (input.notes !== null && (typeof input.notes !== 'string' || input.notes.length > 4000))
    throw new Error('Описание события слишком длинное');
  validateScheduleTiming(input);
  return { ...input, title, notes: input.notes?.trim() || null };
}

const TABLES = ['workoutOccurrences', 'realms', 'members'];

export class PersonalEventRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('INVALID_CLOUD_USER_ID');
  }

  private authorized(row: CloudWorkoutOccurrenceRow | undefined): CloudWorkoutOccurrenceRow {
    if (!row || !isPersonalEvent(row) || row.realmId !== this.actorUserId
      || row.owner !== this.actorUserId || row.athleteUserId !== this.actorUserId
      || row.coachUserId !== null || row.clientUserId !== null || row.format !== 'independent'
      || row.workoutSessionId !== null || row.status !== 'scheduled' || row.cancelledAt
      || row.trainingPlanId !== undefined || row.programDayId !== undefined
      || row.autoCreatedProgram !== undefined || !isWorkoutOccurrencePlan(row.plan)
      || row.plan.exercises.length !== 0) throw new Error('PERSONAL_EVENT_NOT_FOUND');
    return row;
  }

  private async assertSlot(input: Pick<PersonalEventInput, 'startsAtUtc' | 'durationMinutes'>, id?: string) {
    await assertLocalWorkoutSlot(this.db, {
      actorUserId: this.actorUserId, athleteUserId: this.actorUserId,
      coachUserId: null, format: 'independent',
      startsAtUtc: input.startsAtUtc, durationMinutes: input.durationMinutes,
      targetOccurrenceId: id,
    });
  }

  async create(input: PersonalEventInput): Promise<string> {
    const value = validateEvent(input);
    return this.db.transaction('rw', TABLES, async () => {
      await this.assertSlot(value);
      const now = new Date().toISOString();
      const plan = { name: value.title, comment: value.notes, exercises: [] };
      return this.db.workoutOccurrences.add({
        realmId: this.actorUserId, owner: this.actorUserId,
        entryKind: 'personal_event',
        athleteUserId: this.actorUserId, coachUserId: null, clientUserId: null,
        format: 'independent', startsAtUtc: value.startsAtUtc,
        durationMinutes: value.durationMinutes, status: 'scheduled', workoutSessionId: null,
        publicationStatus: 'published', plan, createdByUserId: this.actorUserId, createdAt: now, updatedAt: now,
      });
    });
  }

  async update(id: string, input: PersonalEventInput): Promise<void> {
    const value = validateEvent(input);
    await this.db.transaction('rw', TABLES, async () => {
      const row = this.authorized(await this.db.workoutOccurrences.get(id));
      if (row.startsAtUtc !== value.startsAtUtc || row.durationMinutes !== value.durationMinutes)
        await this.assertSlot(value, id);
      await this.db.workoutOccurrences.update(id, {
        'plan.name': value.title, 'plan.comment': value.notes,
        startsAtUtc: value.startsAtUtc, durationMinutes: value.durationMinutes,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  /** Drag and resize must not overwrite metadata saved by another editor. */
  async move(id: string, timing: Pick<PersonalEventInput, 'startsAtUtc' | 'durationMinutes'>): Promise<void> {
    validateScheduleTiming(timing);
    await this.db.transaction('rw', TABLES, async () => {
      const row = this.authorized(await this.db.workoutOccurrences.get(id));
      if (row.startsAtUtc === timing.startsAtUtc && row.durationMinutes === timing.durationMinutes) return;
      await this.assertSlot(timing, id);
      await this.db.workoutOccurrences.update(id, { ...timing, updatedAt: new Date().toISOString() });
    });
  }

  async cancel(id: string): Promise<void> {
    await this.db.transaction('rw', TABLES, async () => {
      this.authorized(await this.db.workoutOccurrences.get(id));
      const now = new Date().toISOString();
      await this.db.workoutOccurrences.update(id, { cancelledAt: now, updatedAt: now });
    });
  }
}
