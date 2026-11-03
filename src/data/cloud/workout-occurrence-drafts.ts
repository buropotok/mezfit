import { AdHocWorkoutRepository, type CalendarWorkoutSession } from './adhoc-workouts';
import { STARTED_PLAN_MESSAGE } from './planned-session-policy';
import { liveQuery } from 'dexie';
import type { LocalProgramSyncRow, MezfitCloudDatabase } from './database';
import type { CloudWorkoutOccurrenceRow } from './workout-foundation-types';
import type { LocalWorkoutOccurrenceDraft, WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { draftFromOccurrence, isLocalWorkoutOccurrenceDraft, isWorkoutOccurrencePlan } from './workout-occurrence-plan';
import { occurrencePlanChanged } from './workout-occurrence-edit';
import { validateScheduleTiming } from './workout-scheduling-time';
import { assertLocalWorkoutSlot, bookingsOverlap, bookingsShareParticipant, WorkoutSlotConflict } from './workout-slot-validation';
import { isApprovedAssignedPair } from './assigned-programs';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { duplicateWorkoutPlan, isWorkoutRepeatRule, repeatWorkoutStarts, type WorkoutRepeatRule } from './workout-recurrence';
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
  private async executionView(row: CloudWorkoutOccurrenceRow): Promise<CloudWorkoutOccurrenceRow & { executionTiming?: { startedAt: string; completedAt: string | null } }> {
    if (!row.workoutSessionId || !this.executionTables().length || row.entryKind === 'personal_event') return row;
    const execution = await new AdHocWorkoutRepository(this.db, this.actorUserId)
      .getOccurrenceSession(row.id, row.workoutSessionId);
    return execution?.occurrencePlan && execution.realmId === row.realmId
      ? { ...row, status: execution.status === 'active' ? 'in_progress' : 'completed', workoutSessionId: execution.id,
        plan: structuredClone(execution.occurrencePlan),
        executionTiming: { startedAt: execution.startedAt, completedAt: execution.completedAt } } : row;
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
          if (!current || current.inactive || current.cancelledAt || current.entryKind === 'personal_event' || current.realmId !== draft.realmId || current.athleteUserId !== draft.athleteUserId
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

  async create(draft: LocalWorkoutOccurrenceDraft, options: { published?: boolean } = {}): Promise<string> {
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
        status: 'scheduled', workoutSessionId: null, publicationStatus: options.published ? 'published' : 'draft', draftAuthorUserId: this.actorUserId,
        plan: structuredClone(draft.plan), originalPlan: structuredClone(draft.originalPlan), publishedPlan: null,
        ...(draft.pendingRepeatRule ? { pendingRepeatRule: structuredClone(draft.pendingRepeatRule) } : {}),
        createdByUserId: this.actorUserId, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
      });
      await markWorkoutChanged(this.db, id);
      return 'draft:' + id;
    });
  }

  /** Read pending and materialized series state without consuming editor get/Start/Edit intents. */
  async repeatStateFor(occurrenceId: string): Promise<{ rule: WorkoutRepeatRule | null; applied: boolean }> {
    const empty = { rule: null, applied: false };
    const current = await this.db.workoutOccurrences.get(occurrenceId);
    if (!current || current.inactive || current.entryKind === 'personal_event'
      || current.status === 'cancelled' || current.cancelledAt) return empty;
    if (current.publicationStatus === 'draft' && (current.coachUserId ?? current.athleteUserId) !== this.actorUserId
      && (current.draftAuthorUserId ?? current.createdByUserId) !== this.actorUserId) return empty;
    try { await this.authorize(current); }
    catch (reason) { if (reason instanceof WorkoutEditRejected) return empty; throw reason; }
    if (current.repeatSourceId) return {
      rule: isWorkoutRepeatRule(current.repeatRule) ? current.repeatRule : null, applied: true,
    };
    const child = await this.db.workoutOccurrences.where('realmId').equals(current.realmId)
      .filter(row => row.repeatSourceId === occurrenceId).first();
    if (child) return { rule: isWorkoutRepeatRule(child.repeatRule) ? child.repeatRule : null, applied: true };
    return { rule: isWorkoutRepeatRule(current.pendingRepeatRule) ? current.pendingRepeatRule : null, applied: false };
  }

  async repeatRuleFor(occurrenceId: string): Promise<WorkoutRepeatRule | null> {
    return (await this.repeatStateFor(occurrenceId)).rule;
  }

  /** Caller owns one transaction, including publication and every materialized repeat. */
  private async materializeRepeats(occurrenceId: string, rule: WorkoutRepeatRule, allowUnpublished = false): Promise<number> {
    if (!isWorkoutRepeatRule(rule)) throw new Error('Некорректные параметры повторения');
    const row = await this.db.workoutOccurrences.get(occurrenceId);
    const source = await this.get('draft:' + occurrenceId);
    if (!row || !source || (!source.saved && !allowUnpublished) || row.status !== 'scheduled' || row.workoutSessionId
      || row.repeatSourceId || row.cancelledAt || row.inactive)
      throw new Error('Для серии нужна сохранённая запланированная тренировка');
    const existingChildren = await this.db.workoutOccurrences.where('realmId').equals(source.realmId)
      .filter(child => child.repeatSourceId === occurrenceId).count();
    if (existingChildren) throw new Error('Для этой тренировки уже создана серия');
    const starts = repeatWorkoutStarts(source.startsAtUtc, rule);
    const scheduling = new WorkoutSchedulingRepository(this.db, this.actorUserId);
    // Calendar reads and membership checks remain serialized within the local transaction.
    const athlete = await scheduling.listCalendar(source.athleteUserId, true);
    const coach = source.format === 'coached' && source.coachUserId
      ? await scheduling.listCalendar(source.coachUserId, true) : [];
    const bookings: Array<Pick<LocalWorkoutOccurrenceDraft,
      'athleteUserId' | 'coachUserId' | 'format' | 'startsAtUtc' | 'durationMinutes'>> =
      [...athlete, ...coach].filter(item => bookingsShareParticipant(source, item));
    for (const startsAtUtc of starts) {
      const candidate = { ...source, startsAtUtc };
      if (bookings.some(booking => bookingsOverlap(candidate, booking)))
        throw new WorkoutSlotConflict('Одна из дат серии занята другой записью. Измените дни или время');
      bookings.push(candidate);
    }
    const now = new Date().toISOString();
    for (const startsAtUtc of starts) {
      const plan = duplicateWorkoutPlan(source.plan);
      const id = await this.db.workoutOccurrences.add({
        realmId: source.realmId, owner: source.realmId,
        ...(source.trainingPlanId && source.programDayId
          ? { trainingPlanId: source.trainingPlanId, programDayId: source.programDayId } : {}),
        repeatSourceId: occurrenceId, repeatRule: structuredClone(rule),
        athleteUserId: source.athleteUserId, coachUserId: source.coachUserId,
        clientUserId: source.clientUserId, format: source.format,
        startsAtUtc, durationMinutes: source.durationMinutes,
        status: 'scheduled', workoutSessionId: null, publicationStatus: 'published',
        draftAuthorUserId: this.actorUserId,
        plan, originalPlan: structuredClone(plan), publishedPlan: null,
        createdByUserId: this.actorUserId, createdAt: now, updatedAt: now,
      });
      await markWorkoutChanged(this.db, id);
    }
    return starts.length;
  }

  /** Explicit creation remains limited to an already published source. */
  async createRepeats(occurrenceId: string, rule: WorkoutRepeatRule): Promise<number> {
    return this.transaction(() => this.materializeRepeats(occurrenceId, rule));
  }

  /** Reads and publication filters never change synchronization. */
  async get(id: string): Promise<LocalWorkoutOccurrenceDraft | null> {
    if (!id.startsWith('draft:')) return null;
    const row = await this.db.workoutOccurrences.get(id.slice(6));
    if (!row || row.inactive || row.entryKind === 'personal_event' || (row.status === 'cancelled' || row.cancelledAt)) return null;
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

  observeWorkspace(onChange: (value: { occurrences: CloudWorkoutOccurrenceRow[]; drafts: LocalWorkoutOccurrenceDraft[]; cancelled?: CloudWorkoutOccurrenceRow[]; sessions?: CalendarWorkoutSession[] }) => void,
    onError: (reason: unknown) => void) {
    const scheduling = new WorkoutSchedulingRepository(this.db, this.actorUserId);
    return liveQuery(async () => {
      const rows = await Promise.all((await scheduling.listWorkspace(true)).map(row => this.executionView(row)));
      const active = rows.filter(row => !row.cancelledAt && row.status !== 'cancelled');
      const sessions = this.executionTables().length
        ? await new AdHocWorkoutRepository(this.db, this.actorUserId).listForCalendar() : [];
      return { sessions, cancelled: rows.filter(row => row.entryKind !== 'personal_event' && Boolean(row.cancelledAt || row.status === 'cancelled')),
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
      const repeatChanged = JSON.stringify(changed.pendingRepeatRule ?? null) !== JSON.stringify(current.pendingRepeatRule ?? null);
      if (contentChanged || repeatChanged) this.assertPlanEditable(current);
      if (repeatChanged && changed.pendingRepeatRule != null && !isWorkoutRepeatRule(changed.pendingRepeatRule))
        throw new WorkoutEditRejected('INVALID_REPEAT_RULE');
      if (contentChanged && (current.coachUserId ?? current.athleteUserId) !== this.actorUserId)
        throw new WorkoutEditRejected('SCHEDULE_PLAN_FORBIDDEN');
      try { validateScheduleTiming(changed); }
      catch (reason) { throw new WorkoutEditRejected(reason instanceof Error ? reason.message : 'INVALID_SCHEDULE_TIMING'); }
      const timingChanged = changed.startsAtUtc !== current.startsAtUtc || changed.durationMinutes !== current.durationMinutes;
      if (timingChanged) await assertLocalWorkoutSlot(this.db, changed);
      if (timingChanged || contentChanged || repeatChanged) {
        const row = await this.db.workoutOccurrences.get(id.slice(6));
        if (!row) throw new WorkoutEditRejected('OCCURRENCE_DRAFT_NOT_FOUND');
        if (repeatChanged && row.repeatSourceId) throw new WorkoutEditRejected('SERIES_OCCURRENCE_CANNOT_REPEAT');
        if (repeatChanged && changed.pendingRepeatRule) {
          const hasChildren = await this.db.workoutOccurrences.where('realmId').equals(row.realmId)
            .filter(child => child.repeatSourceId === row.id).count();
          if (hasChildren) throw new WorkoutEditRejected('SERIES_ALREADY_CREATED');
        }
        await this.db.workoutOccurrences.update(row.id, {
          ...(timingChanged ? { startsAtUtc: changed.startsAtUtc, durationMinutes: changed.durationMinutes } : {}),
          ...(repeatChanged ? { pendingRepeatRule: changed.pendingRepeatRule
            ? structuredClone(changed.pendingRepeatRule) : null } : {}),
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
      // Materialize before publication in the same local transaction; any conflict
      // rolls back both the publication and every new occurrence.
      if (draft.pendingRepeatRule) await this.materializeRepeats(occurrenceId, draft.pendingRepeatRule, true);
      await this.db.workoutOccurrences.update(occurrenceId, {
        publicationStatus: 'published', updatedAt: new Date().toISOString(),
        ...(draft.pendingRepeatRule ? { pendingRepeatRule: null } : {}),
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
      if (!row || row.inactive || row.entryKind === 'personal_event') throw new Error('OCCURRENCE_NOT_FOUND');
      await this.authorize(row);
      if (row.cancelledAt || row.status === 'cancelled') return;
      this.assertPlanEditable(draftFromOccurrence(this.actorUserId, await this.executionView(row)));
      await this.db.workoutOccurrences.update(occurrenceId, { cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await markWorkoutChanged(this.db, occurrenceId);
    });
  }

  /** Logical deletion only. Retains the full occurrence and its cancellation history.
   * A cancelled record can be removed from the basket; execution records are protected.
   */
  async deactivate(occurrenceId: string): Promise<void> {
    const editorId = 'draft:' + occurrenceId;
    const queue = this.queue(editorId);
    await queue.running.catch(() => undefined);
    await this.transaction(async () => {
      const row = await this.db.workoutOccurrences.get(occurrenceId);
      if (!row || row.entryKind === 'personal_event') throw new WorkoutEditRejected('OCCURRENCE_NOT_FOUND');
      await this.authorize(row);
      if (row.inactive) return;
      const current = await this.executionView(row);
      if (current.workoutSessionId || (current.status !== 'scheduled' && current.status !== 'cancelled'))
        throw new WorkoutEditRejected(STARTED_PLAN_MESSAGE);
      await this.db.workoutOccurrences.update(occurrenceId, { inactive: true, updatedAt: new Date().toISOString() });
      await markWorkoutChanged(this.db, occurrenceId);
    });
    queue.pending.length = 0;
    editQueues.get(this.db)?.delete(this.actorUserId + ':' + editorId);
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
        await this.db.workoutOccurrences.update(row.id, { inactive: true, updatedAt: new Date().toISOString() });
      }
      await markWorkoutChanged(this.db, row.id);
    });
    queue.pending.length = 0;
    editQueues.get(this.db)?.delete(this.actorUserId + ':' + id);
  }
}
