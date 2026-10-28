import { AdHocWorkoutRepository } from './adhoc-workouts';
import { STARTED_PLAN_MESSAGE } from './planned-session-policy';
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
    return this.db.transaction('rw', ['workoutOccurrences',
      'localWorkoutSync', 'realms', 'members',
      ...this.executionTables()], work);
  }

  private executionTables(): string[] {
    return this.db.tables.some(table => table.name === 'adHocSessions') ? ['adHocSessions'] : [];
  }
  private async executionView(row: CloudWorkoutOccurrenceRow): Promise<CloudWorkoutOccurrenceRow> {
    if (!row.workoutSessionId || !this.executionTables().length || row.entryKind === 'personal_event') return row;
    const execution = await new AdHocWorkoutRepository(this.db, this.actorUserId)
      .getOccurrenceSession(row.id, row.workoutSessionId);
    return execution?.occurrencePlan && execution.realmId === row.realmId
      ? { ...row, status: execution.status === 'active' ? 'in_progress' : 'completed', workoutSessionId: execution.id,
        plan: structuredClone(execution.occurrencePlan) } : row;
  }
  private assertPlanEditable(draft: LocalWorkoutOccurrenceDraft): void {
    if (draft.workoutSessionId || (draft.executionStatus && draft.executionStatus !== 'scheduled'))
      throw new WorkoutEditRejected(STARTED_PLAN_MESSAGE);
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

  /** One-time transfer of existing user work from the retired device-only store.
   * This is a local schema transition, never a replication mechanism. */
  async importDeviceDrafts(): Promise<void> {
    await this.db.transaction('rw', ['localWorkoutOccurrenceDrafts', 'workoutOccurrences', 'localWorkoutSync', 'realms', 'members'], async () => {
      const rows = await this.db.localWorkoutOccurrenceDrafts.toArray();
      for (const draft of rows.filter(isLocalWorkoutOccurrenceDraft).filter(row => row.actorUserId === this.actorUserId)) {
        try { await this.authorize(draft); }
        catch (reason) { if (reason instanceof WorkoutEditRejected) continue; throw reason; }
        let id = draft.targetOccurrenceId;
        if (id) {
          const current = await this.db.workoutOccurrences.get(id);
          if (!current || current.entryKind === 'personal_event' || current.realmId !== draft.realmId || current.athleteUserId !== draft.athleteUserId
            || current.coachUserId !== draft.coachUserId || current.clientUserId !== draft.clientUserId
            || current.format !== draft.format) continue;
          await this.db.workoutOccurrences.update(id, { plan: draft.plan, originalPlan: draft.originalPlan,
            publishedPlan: current.plan, publicationStatus: 'draft', draftAuthorUserId: this.actorUserId });
        } else {
          id = await this.db.workoutOccurrences.add({ realmId: draft.realmId, owner: draft.realmId,
            trainingPlanId: draft.trainingPlanId, programDayId: draft.programDayId,
            athleteUserId: draft.athleteUserId, coachUserId: draft.coachUserId, clientUserId: draft.clientUserId,
            format: draft.format, startsAtUtc: draft.startsAtUtc, durationMinutes: draft.durationMinutes,
            status: 'scheduled', workoutSessionId: null, publicationStatus: 'draft', draftAuthorUserId: this.actorUserId, plan: draft.plan,
            originalPlan: draft.originalPlan, publishedPlan: null, createdByUserId: this.actorUserId,
            createdAt: draft.createdAt, updatedAt: draft.updatedAt });
        }
        await markWorkoutChanged(this.db, id);
        await this.db.localWorkoutOccurrenceDrafts.delete(draft.id);
      }
    });
  }

  async create(draft: LocalWorkoutOccurrenceDraft): Promise<string> {
    if (!isLocalWorkoutOccurrenceDraft(draft) || draft.actorUserId !== this.actorUserId)
      throw new WorkoutEditRejected('INVALID_OCCURRENCE_DRAFT');
    return this.transaction(async () => {
      await this.authorize(draft);
      await assertLocalWorkoutSlot(this.db, draft);
      const id = await this.db.workoutOccurrences.add({
        realmId: draft.realmId, owner: draft.realmId,
        trainingPlanId: draft.trainingPlanId, programDayId: draft.programDayId,
        ...(draft.autoCreatedProgram ? { autoCreatedProgram: true } : {}),
        athleteUserId: draft.athleteUserId, coachUserId: draft.coachUserId, clientUserId: draft.clientUserId,
        format: draft.format, startsAtUtc: draft.startsAtUtc, durationMinutes: draft.durationMinutes,
        status: 'scheduled', workoutSessionId: null, publicationStatus: 'draft', draftAuthorUserId: this.actorUserId,
        plan: structuredClone(draft.plan), originalPlan: structuredClone(draft.originalPlan), publishedPlan: null,
        createdByUserId: this.actorUserId, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
      });
      await markWorkoutChanged(this.db, id);
      return 'draft:' + id;
    });
  }

  /** Reads and publication filters never change synchronization. */
  async get(id: string): Promise<LocalWorkoutOccurrenceDraft | null> {
    if (!id.startsWith('draft:')) return null;
    const row = await this.db.workoutOccurrences.get(id.slice(6));
    if (!row || row.entryKind === 'personal_event' || (row.status === 'cancelled' || row.cancelledAt)) return null;
    if (row.publicationStatus === 'draft' && (row.coachUserId ?? row.athleteUserId) !== this.actorUserId
      && (row.draftAuthorUserId ?? row.createdByUserId) !== this.actorUserId) return null;
    try { await this.authorize(row); }
    catch (reason) { if (reason instanceof WorkoutEditRejected) return null; throw reason; }
    return draftFromOccurrence(this.actorUserId, await this.executionView(row));
  }

  async list(): Promise<LocalWorkoutOccurrenceDraft[]> {
    const rows = await Promise.all((await new WorkoutSchedulingRepository(this.db, this.actorUserId).listWorkspace())
      .map(row => this.executionView(row)));
    return rows.filter(row => row.entryKind !== 'personal_event' && row.publicationStatus === 'draft')
      .map(row => draftFromOccurrence(this.actorUserId, row));
  }

  observe(onChange: (drafts: LocalWorkoutOccurrenceDraft[]) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.list()).subscribe({ next: onChange, error: onError });
  }

  observeWorkspace(onChange: (value: { occurrences: CloudWorkoutOccurrenceRow[]; drafts: LocalWorkoutOccurrenceDraft[]; cancelled?: CloudWorkoutOccurrenceRow[] }) => void,
    onError: (reason: unknown) => void) {
    const scheduling = new WorkoutSchedulingRepository(this.db, this.actorUserId);
    return liveQuery(async () => {
      const rows = await Promise.all((await scheduling.listWorkspace(true)).map(row => this.executionView(row)));
      const active = rows.filter(row => !row.cancelledAt && row.status !== 'cancelled');
      return { cancelled: rows.filter(row => row.entryKind !== 'personal_event' && Boolean(row.cancelledAt || row.status === 'cancelled')),
        occurrences: active.filter(row => row.entryKind === 'personal_event' || row.publicationStatus !== 'draft'),
        drafts: active.filter(row => row.entryKind !== 'personal_event' && row.publicationStatus === 'draft')
          .map(row => draftFromOccurrence(this.actorUserId, row)) };
    }).subscribe({ next: onChange, error: onError });
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
        || changed.executionStatus !== current.executionStatus || changed.workoutSessionId !== current.workoutSessionId
        || changed.autoCreatedProgram !== current.autoCreatedProgram
        || changed.clientUserId !== current.clientUserId || changed.coachUserId !== current.coachUserId
        || changed.athleteUserId !== current.athleteUserId || changed.format !== current.format
        || !isWorkoutOccurrencePlan(changed.plan)) throw new WorkoutEditRejected('INVALID_OCCURRENCE_DRAFT');
      const contentChanged = occurrencePlanChanged(changed.plan, current.plan);
      if (contentChanged) this.assertPlanEditable(current);
      if (contentChanged && (current.coachUserId ?? current.athleteUserId) !== this.actorUserId)
        throw new WorkoutEditRejected('SCHEDULE_PLAN_FORBIDDEN');
      try { validateScheduleTiming(changed); }
      catch (reason) { throw new WorkoutEditRejected(reason instanceof Error ? reason.message : 'INVALID_SCHEDULE_TIMING'); }
      const timingChanged = changed.startsAtUtc !== current.startsAtUtc || changed.durationMinutes !== current.durationMinutes;
      if (timingChanged) await assertLocalWorkoutSlot(this.db, changed);
      if (timingChanged || contentChanged) {
        const row = await this.db.workoutOccurrences.get(id.slice(6));
        if (!row) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
        await this.db.workoutOccurrences.update(row.id, {
          ...(timingChanged ? { startsAtUtc: changed.startsAtUtc, durationMinutes: changed.durationMinutes } : {}),
          ...(contentChanged ? { plan: structuredClone(changed.plan), publicationStatus: 'draft' as const, draftAuthorUserId: this.actorUserId,
            publishedPlan: current.saved ? structuredClone(current.plan) : row.publishedPlan ?? null } : {}),
          updatedAt: new Date().toISOString(),
        });
        await markWorkoutChanged(this.db, row.id);
      }
    });
  }

  async replacePlan(id: string, plan: WorkoutOccurrencePlan): Promise<void> {
    await this.enqueueEdit(id, draft => ({ ...draft, plan: structuredClone(plan) }));
  }

  /** Publish locally. All draft contents are already ordinary synchronized records. */
  async save(id: string): Promise<string> {
    await this.flushEdits(id);
    return this.transaction(async () => {
      const draft = await this.get(id);
      if (!draft) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.authorize(draft);
      this.assertPlanEditable(draft);
      await assertLocalWorkoutSlot(this.db, draft);
      const occurrenceId = id.slice(6);
      await this.db.workoutOccurrences.update(occurrenceId, {
        publicationStatus: 'published', updatedAt: new Date().toISOString(),
        ...(draft.autoCreatedProgram && !draft.previouslyPublished ? { publishedPlan: structuredClone(draft.plan) } : {}),
      });
      await markWorkoutChanged(this.db, occurrenceId);
      return occurrenceId;
    });
  }

  async cancel(occurrenceId: string): Promise<void> {
    await this.flushEdits('draft:' + occurrenceId);
    await this.transaction(async () => {
      const row = await this.db.workoutOccurrences.get(occurrenceId);
      if (!row || row.entryKind === 'personal_event') throw new Error('OCCURRENCE_NOT_FOUND');
      await this.authorize(row);
      if (row.cancelledAt || row.status === 'cancelled') return;
      this.assertPlanEditable(draftFromOccurrence(this.actorUserId, await this.executionView(row)));
      await this.db.workoutOccurrences.update(occurrenceId, { cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await markWorkoutChanged(this.db, occurrenceId);
    });
  }

  async delete(id: string): Promise<void> {
    const queue = this.queue(id);
    await queue.running.catch(() => undefined);
    await this.transaction(async () => {
      const draft = await this.get(id);
      if (!draft) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      await this.authorize(draft);
      this.assertPlanEditable(draft);
      if (draft.saved) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      const row = await this.db.workoutOccurrences.get(id.slice(6));
      if (!row) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
      const author = (row.coachUserId ?? row.athleteUserId) === this.actorUserId;
      if (row.publishedPlan && author) {
        await this.db.workoutOccurrences.update(row.id, { plan: row.publishedPlan, publicationStatus: 'published', updatedAt: new Date().toISOString() });
      } else {
        await this.db.workoutOccurrences.update(row.id, { cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      await markWorkoutChanged(this.db, row.id);
    });
    queue.pending.length = 0;
    editQueues.get(this.db)?.delete(this.actorUserId + ':' + id);
  }
}
