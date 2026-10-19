import { liveQuery } from 'dexie';
import type { LocalProgramSyncRow, MezfitCloudDatabase } from './database';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft, WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { draftFromOccurrence, isLocalWorkoutOccurrenceDraft, isWorkoutOccurrencePlan } from './workout-occurrence-plan';
import { occurrencePlanChanged } from './workout-occurrence-edit';
import { validateScheduleTiming } from './workout-scheduling-time';
import { assertLocalWorkoutSlot, WorkoutSlotConflict } from './workout-slot-validation';
import { isApprovedAssignedPair } from './assigned-programs';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { markWorkoutChanged } from './workout-sync';

class WorkoutEditRejected extends Error {}

/** A rejected local choice is distinct from a storage failure retained for retry. */
export function isWorkoutEditRejected(reason: unknown): reason is Error {
  return reason instanceof WorkoutEditRejected || reason instanceof WorkoutSlotConflict;
}

type DraftEdit = (draft: LocalWorkoutOccurrenceDraft) => LocalWorkoutOccurrenceDraft;
interface EditQueue { pending: DraftEdit[]; running: Promise<void>; error: string }
// Only local storage intents. Addon owns all replication, independently of editors.
const editQueues = new WeakMap<MezfitCloudDatabase, Map<string, EditQueue>>();

export class WorkoutOccurrenceDraftRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('INVALID_CLOUD_USER_ID');
  }

  private transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', ['localWorkoutOccurrenceDrafts', 'workoutOccurrences',
      'localWorkoutSync', 'realms', 'members'], work);
  }

  private async authorize(row: Pick<LocalWorkoutOccurrenceDraft, 'realmId' | 'athleteUserId' | 'coachUserId' | 'clientUserId' | 'format'>): Promise<void> {
    if (!row.coachUserId && !row.clientUserId && row.realmId === this.actorUserId
      && row.athleteUserId === this.actorUserId && row.format === 'independent') return;
    if (!row.coachUserId || !row.clientUserId || row.athleteUserId !== row.clientUserId
      || (this.actorUserId !== row.coachUserId && this.actorUserId !== row.clientUserId)
      || (row.format === 'coached' && this.actorUserId !== row.coachUserId)) throw new WorkoutEditRejected('SCHEDULE_FORBIDDEN');
    const realm = await this.db.realms.get(row.realmId);
    const members = await this.db.members.where('realmId').equals(row.realmId).toArray();
    if (!await isApprovedAssignedPair(realm, members, row.coachUserId, row.clientUserId)) throw new WorkoutEditRejected('SCHEDULE_FORBIDDEN');
  }

  async create(draft: LocalWorkoutOccurrenceDraft): Promise<string> {
    if (!isLocalWorkoutOccurrenceDraft(draft) || draft.actorUserId !== this.actorUserId)
      throw new WorkoutEditRejected('INVALID_OCCURRENCE_DRAFT');
    return this.transaction(async () => {
      await this.authorize(draft);
      await assertLocalWorkoutSlot(this.db, draft);
      await this.db.localWorkoutOccurrenceDrafts.add({ ...structuredClone(draft), saved: false });
      return draft.id;
    });
  }

  /** Opening a saved occurrence is a read, never a persisted draft creation. */
  async get(id: string): Promise<LocalWorkoutOccurrenceDraft | null> {
    const value: unknown = await this.db.localWorkoutOccurrenceDrafts.get(id);
    if (isLocalWorkoutOccurrenceDraft(value) && value.actorUserId === this.actorUserId)
      return { ...value, saved: false };
    if (!id.startsWith('draft:')) return null;
    const row = await this.db.workoutOccurrences.get(id.slice(6));
    if (!row || row.status === 'cancelled' || row.cancelledAt) return null;
    try { await this.authorize(row); }
    catch (reason) { if (reason instanceof WorkoutEditRejected) return null; throw reason; }
    return draftFromOccurrence(this.actorUserId, row);
  }

  async list(): Promise<LocalWorkoutOccurrenceDraft[]> {
    const rows: unknown[] = await this.db.localWorkoutOccurrenceDrafts.toArray();
    return rows.filter(isLocalWorkoutOccurrenceDraft).filter(draft => draft.actorUserId === this.actorUserId)
      .map(draft => ({ ...draft, saved: false }))
      .sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc) || a.id.localeCompare(b.id));
  }

  observe(onChange: (drafts: LocalWorkoutOccurrenceDraft[]) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.list()).subscribe({ next: onChange, error: onError });
  }

  observeWorkspace(onChange: (value: { occurrences: CloudWorkoutOccurrenceRow[]; drafts: LocalWorkoutOccurrenceDraft[] }) => void,
    onError: (reason: unknown) => void) {
    const scheduling = new WorkoutSchedulingRepository(this.db, this.actorUserId);
    return liveQuery(async () => ({ occurrences: await scheduling.listCalendar(), drafts: await this.list() }))
      .subscribe({ next: onChange, error: onError });
  }

  observeSync(id: string, onChange: (row: LocalProgramSyncRow | undefined) => void,
    onError: (reason: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.db.localWorkoutSync.get(id)).subscribe({ next: onChange, error: onError });
  }

  private queue(id: string): EditQueue {
    let queues = editQueues.get(this.db);
    if (!queues) { queues = new Map(); editQueues.set(this.db, queues); }
    const key = this.actorUserId + ':' + id;
    let queue = queues.get(key);
    if (!queue) {
      queue = { pending: [], running: Promise.resolve(), error: '' };
      queues.set(key, queue);
    }
    return queue;
  }

  pendingEditError(id: string): string { return this.queue(id).error; }

  async enqueueEdit(id: string, apply: DraftEdit): Promise<void> {
    this.queue(id).pending.push(apply);
    return this.flushEdits(id);
  }

  flushEdits(id: string): Promise<void> {
    const queue = this.queue(id);
    if (!queue.pending.length) return queue.running.catch(() => undefined);
    const next = queue.running.catch(() => undefined).then(async () => {
      while (queue.pending.length) {
        try { await this.edit(id, queue.pending[0]); }
        catch (reason) {
          // Rejected user choices are discarded. Storage failures retain the intent for retry.
          if (reason instanceof WorkoutEditRejected || reason instanceof WorkoutSlotConflict) queue.pending.shift();
          throw reason;
        }
        queue.pending.shift();
      }
      queue.error = '';
    });
    queue.running = next;
    void next.catch(reason => {
      queue.error = queue.pending.length ? reason instanceof Error ? reason.message : 'Не удалось сохранить черновик' : '';
    });
    return next;
  }

  /** Content edits become private drafts; timing edits commit immediately without changing that status. */
  async edit(id: string, apply: DraftEdit): Promise<void> {
    await this.transaction(async () => {
      const current = await this.get(id);
      if (!current) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.authorize(current);
      const changed = apply(structuredClone(current));
      if (changed.id !== current.id || changed.actorUserId !== current.actorUserId
        || changed.targetOccurrenceId !== current.targetOccurrenceId
        || changed.realmId !== current.realmId || changed.programDayId !== current.programDayId
        || changed.trainingPlanId !== current.trainingPlanId
        || changed.clientUserId !== current.clientUserId || changed.coachUserId !== current.coachUserId
        || changed.athleteUserId !== current.athleteUserId || changed.format !== current.format
        || !isWorkoutOccurrencePlan(changed.plan)) throw new WorkoutEditRejected('INVALID_OCCURRENCE_DRAFT');
      const contentChanged = occurrencePlanChanged(changed.plan, current.plan);
      if (contentChanged && (current.coachUserId ?? current.athleteUserId) !== this.actorUserId)
        throw new WorkoutEditRejected('SCHEDULE_PLAN_FORBIDDEN');
      try { validateScheduleTiming(changed); }
      catch (reason) { throw new WorkoutEditRejected(reason instanceof Error ? reason.message : 'INVALID_SCHEDULE_TIMING'); }
      const timingChanged = changed.startsAtUtc !== current.startsAtUtc || changed.durationMinutes !== current.durationMinutes;
      if (timingChanged) {
        await assertLocalWorkoutSlot(this.db, changed);
        if (current.targetOccurrenceId) {
          await this.db.workoutOccurrences.update(current.targetOccurrenceId, {
            startsAtUtc: changed.startsAtUtc, durationMinutes: changed.durationMinutes, updatedAt: new Date().toISOString(),
          });
          await markWorkoutChanged(this.db, current.targetOccurrenceId);
        }
      }
      if (contentChanged || !current.saved) {
        await this.db.localWorkoutOccurrenceDrafts.put({ ...changed, saved: false, updatedAt: new Date().toISOString() });
      }
    });
  }

  async replacePlan(id: string, plan: WorkoutOccurrencePlan): Promise<void> {
    await this.enqueueEdit(id, draft => ({ ...draft, plan: structuredClone(plan) }));
  }

  /** One local transaction publishes the PLAN and retires the private draft. No HTTP or sync barrier. */
  async save(id: string): Promise<string> {
    await this.flushEdits(id);
    return this.transaction(async () => {
      const draft = await this.get(id);
      if (!draft) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.authorize(draft);
      await assertLocalWorkoutSlot(this.db, draft);
      const now = new Date().toISOString();
      let occurrenceId = draft.targetOccurrenceId;
      if (occurrenceId) {
        const current = await this.db.workoutOccurrences.get(occurrenceId);
        if (!current || current.realmId !== draft.realmId || current.athleteUserId !== draft.athleteUserId
          || current.coachUserId !== draft.coachUserId || current.clientUserId !== draft.clientUserId
          || current.format !== draft.format) throw new WorkoutEditRejected('SCHEDULE_FORBIDDEN');
        if (occurrencePlanChanged(draft.plan, current.plan)
          && (draft.coachUserId ?? draft.athleteUserId) !== this.actorUserId) throw new WorkoutEditRejected('SCHEDULE_PLAN_FORBIDDEN');
        await this.db.workoutOccurrences.update(occurrenceId, {
          ...((draft.coachUserId ?? draft.athleteUserId) === this.actorUserId ? { plan: structuredClone(draft.plan) } : {}),
          updatedAt: now,
        });
      } else {
        // Addon 4.4.15 replaces null owners. A realm ID cannot match a verified tg:<id> subject.
        const row: Omit<CloudWorkoutOccurrenceRow, 'id'> = {
          realmId: draft.realmId, owner: draft.realmId,
          trainingPlanId: draft.trainingPlanId, programDayId: draft.programDayId,
          athleteUserId: draft.athleteUserId, coachUserId: draft.coachUserId, clientUserId: draft.clientUserId,
          format: draft.format, startsAtUtc: draft.startsAtUtc, durationMinutes: draft.durationMinutes,
          status: 'scheduled', workoutSessionId: null, plan: structuredClone(draft.plan),
          createdByUserId: this.actorUserId, createdAt: now, updatedAt: now,
        };
        occurrenceId = await this.db.workoutOccurrences.add(row);
      }
      await markWorkoutChanged(this.db, occurrenceId);
      const privateDraft = await this.db.localWorkoutOccurrenceDrafts.get(id);
      if (privateDraft?.actorUserId === this.actorUserId) await this.db.localWorkoutOccurrenceDrafts.delete(id);
      return occurrenceId;
    });
  }

  async cancel(occurrenceId: string): Promise<void> {
    await this.transaction(async () => {
      const row = await this.db.workoutOccurrences.get(occurrenceId);
      if (!row) throw new Error('OCCURRENCE_NOT_FOUND');
      await this.authorize(row);
      await this.db.workoutOccurrences.update(occurrenceId, { cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const drafts = await this.list();
      await this.db.localWorkoutOccurrenceDrafts.bulkDelete(drafts.filter(draft => draft.targetOccurrenceId === occurrenceId).map(draft => draft.id));
      await markWorkoutChanged(this.db, occurrenceId);
    });
  }

  async delete(id: string): Promise<void> {
    const queue = this.queue(id);
    await queue.running.catch(() => undefined);
    await this.db.transaction('rw', this.db.localWorkoutOccurrenceDrafts, async () => {
      const draft = await this.db.localWorkoutOccurrenceDrafts.get(id);
      if (!draft || draft.actorUserId !== this.actorUserId) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.db.localWorkoutOccurrenceDrafts.delete(id);
    });
    queue.pending.length = 0;
    editQueues.get(this.db)?.delete(this.actorUserId + ':' + id);
  }
}
