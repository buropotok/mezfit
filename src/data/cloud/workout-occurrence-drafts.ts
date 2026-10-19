import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import type { LocalWorkoutOccurrenceDraft, WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { isLocalWorkoutOccurrenceDraft, isWorkoutOccurrencePlan } from './workout-occurrence-plan';
import { validateScheduleTiming } from './workout-scheduling-time';

type DraftEdit = (draft: LocalWorkoutOccurrenceDraft) => LocalWorkoutOccurrenceDraft;
interface EditQueue { pending: DraftEdit[]; running: Promise<void>; error: string; submitting: boolean }
// Owned by the local database/account, not by an editor's mount lifetime.
// This is only an IndexedDB write queue; Dexie Cloud still owns replication.
const editQueues = new WeakMap<MezfitCloudDatabase, Map<string, EditQueue>>();

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

  private queue(id: string): EditQueue {
    let queues = editQueues.get(this.db);
    if (!queues) { queues = new Map(); editQueues.set(this.db, queues); }
    const key = this.actorUserId + ':' + id;
    let queue = queues.get(key);
    if (!queue) {
      queue = { pending: [], running: Promise.resolve(), error: '', submitting: false };
      queues.set(key, queue);
    }
    return queue;
  }

  pendingEditError(id: string): string { return this.queue(id).error; }

  async enqueueEdit(id: string, apply: DraftEdit): Promise<void> {
    const queue = this.queue(id);
    if (queue.submitting || (await this.get(id))?.submissionPending || queue.submitting) throw new Error('Сначала подтвердите сохранение тренировки');
    this.queue(id).pending.push(apply);
    return this.flushEdits(id);
  }

  flushEdits(id: string): Promise<void> {
    const queue = this.queue(id);
    if (!queue.pending.length) return queue.running;
    const next = queue.running.catch(() => undefined).then(async () => {
      while (queue.pending.length) {
        await this.edit(id, queue.pending[0]);
        queue.pending.shift();
      }
      queue.error = '';
    });
    queue.running = next;
    void next.catch(reason => {
      queue.error = reason instanceof Error ? reason.message : 'Не удалось сохранить черновик';
    });
    return next;
  }

  /** Each action commits immediately, avoiding lost edits from debounced unmounts. */
  async edit(id: string, apply: (draft: LocalWorkoutOccurrenceDraft) => LocalWorkoutOccurrenceDraft): Promise<void> {
    await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
      const current = await this.get(id);
      if (!current) throw new Error('OCCURRENCE_DRAFT_NOT_FOUND');
      if (current.submissionPending) throw new Error('Сначала подтвердите сохранение тренировки');
      const changed = apply(structuredClone(current));
      if (changed.id !== current.id || changed.actorUserId !== current.actorUserId
        || changed.targetOccurrenceId !== current.targetOccurrenceId
        || changed.cancelRequested !== current.cancelRequested
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

  async prepareSubmission(id: string): Promise<{ draft: LocalWorkoutOccurrenceDraft; isNewSubmission: boolean }> {
    const queue = this.queue(id);
    const previous = queue.submitting;
    queue.submitting = true;
    try {
      await this.flushEdits(id);
      return await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
        const draft = await this.get(id);
        if (!draft) throw new Error('OCCURRENCE_DRAFT_NOT_FOUND');
        const isNewSubmission = !draft.submissionPending;
        if (isNewSubmission) {
          draft.submissionPending = true;
          await this.db.localWorkoutOccurrenceDrafts.put(draft);
        }
        return { draft, isNewSubmission };
      });
    } catch (reason) { queue.submitting = previous; throw reason; }
  }

  /** Only used after a definite refusal of the very first submission. */
  async releaseSubmission(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
      const draft = await this.get(id);
      if (!draft) throw new Error('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.db.localWorkoutOccurrenceDrafts.put({ ...draft, submissionPending: false });
    });
    this.queue(id).submitting = false;
  }

  async delete(id: string, confirmed = false): Promise<void> {
    // Explicit deletion discards failed intents, but waits for in-flight writes
    // so they cannot recreate the draft after the deletion transaction.
    const queue = this.queue(id);
    if (queue.submitting && !confirmed) throw new Error('Сначала подтвердите сохранение тренировки');
    await queue.running.catch(() => undefined);
    await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
      const current = await this.get(id);
      if (!current) throw new Error('OCCURRENCE_DRAFT_NOT_FOUND');
      if (current.submissionPending && !confirmed) throw new Error('Сначала подтвердите сохранение тренировки');
      await this.db.localWorkoutOccurrenceDrafts.delete(id);
    });
    queue.pending.length = 0;
    editQueues.get(this.db)?.delete(this.actorUserId + ':' + id);
  }
}
