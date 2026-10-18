import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft, WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { isLocalWorkoutOccurrenceDraft, isWorkoutOccurrencePlan } from './workout-occurrence-plan';
import { validateScheduleTiming } from './workout-scheduling-time';

/** Unsynced, private account-local records in the app's single Dexie database. */
export class WorkoutOccurrenceDraftRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('INVALID_CLOUD_USER_ID');
  }

  async create(draft: LocalWorkoutOccurrenceDraft): Promise<string> {
    if (!isLocalWorkoutOccurrenceDraft(draft) || draft.actorUserId !== this.actorUserId)
      throw new Error('INVALID_OCCURRENCE_DRAFT');
    await this.db.localWorkoutOccurrenceDrafts.add(structuredClone(draft));
    return draft.id;
  }

  async get(id: string): Promise<LocalWorkoutOccurrenceDraft | null> {
    const value: unknown = await this.db.localWorkoutOccurrenceDrafts.get(id);
    return isLocalWorkoutOccurrenceDraft(value) && value.actorUserId === this.actorUserId ? value : null;
  }

  async list(): Promise<LocalWorkoutOccurrenceDraft[]> {
    const rows: unknown[] = await this.db.localWorkoutOccurrenceDrafts.toArray();
    return rows.filter(isLocalWorkoutOccurrenceDraft).filter(draft => draft.actorUserId === this.actorUserId)
      .sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc) || a.id.localeCompare(b.id));
  }

  observe(onChange: (drafts: LocalWorkoutOccurrenceDraft[]) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.list()).subscribe({ next: onChange, error: onError });
  }

  /** Each action commits immediately, avoiding lost edits from debounced unmounts. */
  async edit(id: string, apply: (draft: LocalWorkoutOccurrenceDraft) => LocalWorkoutOccurrenceDraft): Promise<void> {
    await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
      const current = await this.get(id);
      if (!current) throw new Error('OCCURRENCE_DRAFT_NOT_FOUND');
      const changed = apply(structuredClone(current));
      if (changed.id !== current.id || changed.actorUserId !== current.actorUserId
        || changed.realmId !== current.realmId || changed.programDayId !== current.programDayId
        || changed.trainingPlanId !== current.trainingPlanId
        || changed.clientUserId !== current.clientUserId || changed.coachUserId !== current.coachUserId
        || changed.athleteUserId !== current.athleteUserId
        || !isWorkoutOccurrencePlan(changed.plan)) throw new Error('INVALID_OCCURRENCE_DRAFT');
      validateScheduleTiming(changed);
      await this.db.localWorkoutOccurrenceDrafts.put({ ...changed, updatedAt: new Date().toISOString() });
    });
  }

  async replacePlan(id: string, plan: WorkoutOccurrencePlan): Promise<void> {
    await this.edit(id, draft => ({ ...draft, plan: structuredClone(plan) }));
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
      const current = await this.get(id);
      if (!current) throw new Error('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.db.localWorkoutOccurrenceDrafts.delete(id);
    });
  }
}
