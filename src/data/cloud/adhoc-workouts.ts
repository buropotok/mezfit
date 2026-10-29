import clientExecutionGrants from '../../../cloud/client-session-roles.json';
import { PlannedWorkoutConflict, currentStartConflicts } from './planned-workout-conflicts';
import { STARTED_PLAN_MESSAGE } from './planned-session-policy';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { markWorkoutChanged } from './workout-sync';
import { liveQuery } from 'dexie';
import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import { adHocSessionValidationIssue, type AdHocSessionValidationIssue, isAdHocSessionRow, isAdHocExerciseRow, isAdHocSetRow, isAdHocFactDraft,
  type AdHocExerciseRow, type AdHocSessionRow, type AdHocSetRow } from './adhoc-workout-types';
import { isApprovedAssignedPair } from './assigned-programs';
import { ProgramManagementRepository } from './program-management';
import { orderedPlanRows } from './program-day-tree';
import { programExerciseSnapshot, readProgramCatalogueExercise } from './program-exercise-selection';
import { isWorkoutExerciseSnapshot, type CloudWorkoutOccurrenceRow, type CloudProgramExerciseSnapshot, type CloudWorkoutExerciseSnapshot } from './workout-foundation-types';
import { snapshotProgramDay, type WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { isExerciseTrackingType } from '../exercises/publicExerciseTypes';
import { isSetType } from '../../../shared/set-type';
import type { ActiveWorkoutSession } from '../../workout/workoutSessionTypes';
import type { SessionExerciseData, SessionExerciseSetData } from '../../workout/sessionExerciseTypes';
import type { ExistingSetFact, SetEntryFactDraft, SetType } from '../../workout/setEntryTypes';

export type { AdHocSessionRow, AdHocExerciseRow, AdHocSetRow } from './adhoc-workout-types';

export type AdHocOpenSession = Pick<AdHocSessionRow, 'id' | 'name' | 'status'>;
/** Read-only calendar projection; format is not persisted on the execution row. */
export type CalendarWorkoutSession = AdHocSessionRow & Pick<CloudWorkoutOccurrenceRow, 'format'>;

export type AdHocSessionAccessIssue = AdHocSessionValidationIssue | 'ADHOC_LOCAL_RECORD_MISSING'
  | 'ADHOC_PERSONAL_ACCESS_INVALID' | 'ADHOC_RELATIONSHIP_IDENTITY_INVALID' | 'ADHOC_RELATIONSHIP_UNAVAILABLE';

const executionTables = ['adHocSessions', 'adHocExercises', 'adHocSets', 'realms', 'members'];
const programTables = ['trainingPlans', 'programPhases', 'programDays', 'programExercises',
  'programSets', 'localProgramSync', 'roles'];
const catalogueTables = ['publicExerciseDefinitions', 'publicExerciseCatalogues', 'coachExerciseDefinitions'];
function hasPlannedLifecycleGrant(value: unknown, role = 'coach', requireFormat = false): boolean {
  if (!value || typeof value !== 'object' || !('realmId' in value) || value.realmId !== 'rlm-public'
    || !('name' in value) || value.name !== role || !('permissions' in value)) return false;
  const permissions = value.permissions;
  if (!permissions || typeof permissions !== 'object' || !('add' in permissions) || !('update' in permissions)) return false;
  const add = permissions.add, update = permissions.update;
  if (!Array.isArray(add) || !['adHocSessions', 'adHocExercises', 'adHocSets'].every(table => add.includes(table))
    || !update || typeof update !== 'object' || !('workoutOccurrences' in update)) return false;
  const fields = update.workoutOccurrences;
  return Array.isArray(fields) && ['status', 'workoutSessionId', ...(requireFormat ? ['format'] : [])].every(field => fields.includes(field));
}
/** Local activation guard only; cloud ACL remains the authorization boundary. */
function hasClientExecutionGrant(value: unknown): boolean {
  if (!hasPlannedLifecycleGrant(value, 'client') || !value || typeof value !== 'object'
    || !('permissions' in value) || !value.permissions || typeof value.permissions !== 'object'
    || !('update' in value.permissions)) return false;
  const update = value.permissions.update;
  if (!update || typeof update !== 'object') return false;
  return Object.entries(clientExecutionGrants.roles.client.permissions.update).every(([table, fields]) => {
    if (!(table in update)) return false;
    const actual: unknown = Reflect.get(update, table);
    return Array.isArray(actual) && fields.every(field => actual.includes(field));
  });
}
const now = () => new Date().toISOString();
function localWorkoutDate(startedAt: string): string {
  const date = new Date(startedAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
const owner = (row: AdHocSessionRow) => row.realmId;
const blankFact = () => ({ actualReps: null, actualWeightKg: null, actualDurationSeconds: null,
  actualDistanceMeters: null, setLabel: null, rpe: null, comment: null, bands: [], setStatus: 'pending' as const });
function name(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 120) throw new Error('ADHOC_INVALID_NAME');
  return raw.trim();
}
function comment(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length > 4000) throw new Error('ADHOC_INVALID_COMMENT');
  return raw.trim() || null;
}
function idsValid(ids: string[], allowEmpty = false): boolean {
  return Array.isArray(ids) && (allowEmpty || ids.length > 0) && ids.length <= 100
    && ids.every(id => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length;
}
function factOf(row: AdHocSetRow): ExistingSetFact {
  return { metrics: { reps: row.actualReps, weightKg: row.actualWeightKg,
    durationSeconds: row.actualDurationSeconds, distanceMeters: row.actualDistanceMeters },
  setType: row.setType, setLabel: row.setLabel, rpe: row.rpe, comment: row.comment, bands: [...row.bands] };
}

/** Match the established result-entry parser; never spread caller fields into storage. */
function factPatch(fact: SetEntryFactDraft) {
  if (!isAdHocFactDraft(fact)) throw new Error('ADHOC_INVALID_FACT');
  const m = fact.metrics;
  return { actualReps: m.reps, actualWeightKg: m.weightKg, actualDurationSeconds: m.durationSeconds,
    actualDistanceMeters: m.distanceMeters, setLabel: fact.setLabel, setType: fact.setType ?? null,
    rpe: fact.rpe, comment: fact.comment?.trim().slice(0, 1000) || null, bands: [...new Set(fact.bands)],
    setStatus: [m.reps, m.weightKg, m.durationSeconds, m.distanceMeters].some(value => value !== null)
      ? 'completed' as const : 'pending' as const };
}

/** All execution writes commit locally; Dexie Cloud Addon owns replication. */
export class AdHocWorkoutRepository {
  /** The existing Coach slice stays unchanged until Client UI adopts its explicit repository. */
  protected get clientExecution(): boolean { return false; }
  readonly programs: ProgramManagementRepository;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    if (!/^tg:[1-9]\d*$/.test(actorUserId)) throw new Error('ADHOC_INVALID_ACTOR');
    this.programs = new ProgramManagementRepository(db, actorUserId);
  }

  private write<T>(extra: string[], task: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', [...new Set([...executionTables, ...(this.clientExecution ? ['roles'] : []), ...extra])], task);
  }
  private async accessIssue(row: AdHocSessionRow): Promise<AdHocSessionAccessIssue | null> {
    const invalid = adHocSessionValidationIssue(row);
    if (invalid) return invalid;
    if (row.realmId === this.actorUserId) return row.athleteUserId === this.actorUserId
      && row.creatorUserId === this.actorUserId && row.coachUserId === null && row.clientUserId === null
      ? null : 'ADHOC_PERSONAL_ACCESS_INVALID';
    if (!row.coachUserId || !row.clientUserId || row.athleteUserId !== row.clientUserId
      || (row.creatorUserId !== row.coachUserId && row.creatorUserId !== row.clientUserId)
      || (this.actorUserId !== row.coachUserId && this.actorUserId !== row.clientUserId))
      return 'ADHOC_RELATIONSHIP_IDENTITY_INVALID';
    return await isApprovedAssignedPair(await this.db.realms.get(row.realmId),
      await this.db.members.where('realmId').equals(row.realmId).toArray(), row.coachUserId, row.clientUserId)
      ? null : 'ADHOC_RELATIONSHIP_UNAVAILABLE';
  }
  private async accessible(row: AdHocSessionRow): Promise<boolean> {
    return (await this.accessIssue(row)) === null;
  }
  /** Authorized execution headers for the calendar, including completed history. */
  async listForCalendar(): Promise<CalendarWorkoutSession[]> {
    const result: CalendarWorkoutSession[] = [];
    for (const row of await this.db.adHocSessions.toArray()) {
      if (!isAdHocSessionRow(row) || !await this.accessible(row)) continue;
      const occurrence = row.occurrenceId ? await this.db.workoutOccurrences.get(row.occurrenceId) : null;
      const linked = occurrence && occurrence.realmId === row.realmId
        && occurrence.athleteUserId === row.athleteUserId && occurrence.coachUserId === row.coachUserId
        && occurrence.clientUserId === row.clientUserId
        && (!occurrence.workoutSessionId || occurrence.workoutSessionId === row.id);
      result.push({ ...row, format: linked ? occurrence.format : row.coachUserId ? 'coached' : 'independent' });
    }
    return result;
  }
  async getRow(id: string): Promise<AdHocSessionRow | null> {
    const row = await this.db.adHocSessions.get(id);
    return row && await this.accessible(row) ? row : null;
  }
  private async require(id: string, active = true): Promise<AdHocSessionRow> {
    const row = await this.getRow(id);
    if (!row) throw new Error('ADHOC_SESSION_NOT_FOUND');
    if (this.clientExecution) {
      if (row.athleteUserId !== this.actorUserId) throw new Error('ADHOC_WRITE_FORBIDDEN');
      await this.requireClientExecutionGrant(row.realmId);
    } else if (row.creatorUserId !== this.actorUserId
      || (row.realmId !== this.actorUserId && row.coachUserId !== this.actorUserId)) {
      throw new Error('ADHOC_WRITE_FORBIDDEN');
    }
    if (active && row.status !== 'active') throw new Error('ADHOC_SESSION_COMPLETED');
    return row;
  }
  private async exercises(session: AdHocSessionRow): Promise<AdHocExerciseRow[]> {
    return orderedPlanRows((await this.db.adHocExercises.where('sessionId').equals(session.id).toArray())
      .filter(row => isAdHocExerciseRow(row) && !row.deletedAt && row.realmId === session.realmId && row.owner === owner(session)));
  }
  private async sets(session: AdHocSessionRow): Promise<AdHocSetRow[]> {
    return orderedPlanRows((await this.db.adHocSets.where('sessionId').equals(session.id).toArray())
      .filter(row => isAdHocSetRow(row) && !row.deletedAt && row.realmId === session.realmId && row.owner === owner(session)));
  }
  private async exercise(session: AdHocSessionRow, id: string): Promise<AdHocExerciseRow> {
    const row = await this.db.adHocExercises.get(id);
    if (!isAdHocExerciseRow(row) || row.deletedAt || row.sessionId !== session.id || row.realmId !== session.realmId
      || row.owner !== owner(session) || !isWorkoutExerciseSnapshot(row.exercise))
      throw new Error('ADHOC_EXERCISE_NOT_FOUND');
    return row;
  }
  private async set(session: AdHocSessionRow, id: string): Promise<AdHocSetRow> {
    const row = await this.db.adHocSets.get(id);
    if (!isAdHocSetRow(row) || row.deletedAt || row.sessionId !== session.id || row.realmId !== session.realmId
      || row.owner !== owner(session)) throw new Error('ADHOC_SET_NOT_FOUND');
    await this.exercise(session, row.exerciseId);
    return row;
  }
  private async touch(id: string): Promise<void> {
    await this.db.adHocSessions.update(id, { updatedAt: now() });
  }

  listPrograms(athleteUserId: string): Promise<CloudTrainingPlanRow[]> {
    return this.programs.listForScheduling(athleteUserId);
  }
  private async assertStartAvailable(athleteUserId: string, timestamp: string,
    occurrenceId?: string, workspace?: readonly CloudWorkoutOccurrenceRow[]): Promise<void> {
    const rows = workspace ?? await new WorkoutSchedulingRepository(this.db, this.actorUserId).listWorkspace();
    // Client Start occupies the athlete, never the client as a fictitious Coach.
    const conflicts = currentStartConflicts({ id: occurrenceId, athleteUserId,
      coachUserId: this.clientExecution ? null : this.actorUserId }, rows, timestamp);
    if (conflicts.length) throw new PlannedWorkoutConflict(conflicts);
  }
  createQuick(): Promise<{ id: string; createdProgram: boolean }> {
    return this.write(['workoutOccurrences'], async () => {
      await this.requireNoActiveSession();
      const timestamp = now();
      await this.assertStartAvailable(this.actorUserId, timestamp);
      const id = await this.db.adHocSessions.add({
        realmId: this.actorUserId, owner: this.actorUserId, athleteUserId: this.actorUserId,
        coachUserId: null, clientUserId: null, creatorUserId: this.actorUserId,
        name: 'Тренировка', comment: null, programName: null, autoCreatedProgram: false,
        startedAt: timestamp, completedAt: null, status: 'active', createdAt: timestamp, updatedAt: timestamp,
      });
      return { id, createdProgram: false };
    });
  }
  createForAthlete(athleteUserId: string, programId?: string, dayId?: string): Promise<{ id: string; createdProgram: boolean }> {
    if (this.clientExecution) return Promise.reject(new Error('CLIENT_SOURCE_PLAN_FORBIDDEN'));
    if (typeof athleteUserId !== 'string' || !/^tg:[1-9]\d*$/.test(athleteUserId)
      || (programId !== undefined && (typeof programId !== 'string' || !programId))
      || (dayId !== undefined && (typeof dayId !== 'string' || !dayId || !programId)))
      return Promise.reject(new Error('ADHOC_INVALID_TARGET'));
    return this.write(['workoutOccurrences', ...programTables, ...catalogueTables], async () => {
      await this.requireNoActiveSession();
      // Eligibility, default graph and execution snapshot share one transaction.
      const programs = await this.listPrograms(athleteUserId);
      let selectedProgramId = programId, selectedDayId = dayId;
      let createdProgram = false;
      if (!selectedProgramId) {
        if (programs.length) throw new Error('ADHOC_PROGRAM_SELECTION_REQUIRED');
        selectedProgramId = athleteUserId === this.actorUserId
          ? await this.programs.createPersonal('Моя программа')
          : await this.programs.createAssigned(athleteUserId, 'Моя программа');
        createdProgram = true;
        const details = await this.programs.details(selectedProgramId);
        if (!details?.phases[0]) throw new Error('ADHOC_PROGRAM_NOT_FOUND');
        selectedDayId = await this.programs.createDay(selectedProgramId, details.phases[0].id, 'Тренировка');
      } else if (!programs.some(row => row.id === selectedProgramId)) throw new Error('ADHOC_PROGRAM_NOT_FOUND');
      const details = await this.programs.details(selectedProgramId);
      if (!details) throw new Error('ADHOC_PROGRAM_NOT_FOUND');
      const day = selectedDayId ? details.days?.find(row => row.day.id === selectedDayId) : undefined;
      if (selectedDayId && !day) throw new Error('ADHOC_DAY_NOT_FOUND');
      const program = details.program, timestamp = now();
      await this.assertStartAvailable(athleteUserId, timestamp);
      const sessionName = day?.day.name ?? 'Тренировка';
      const id = await this.db.adHocSessions.add({
        realmId: program.realmId, owner: program.realmId, athleteUserId,
        coachUserId: program.coachUserId, clientUserId: program.clientUserId, creatorUserId: this.actorUserId,
        name: sessionName, comment: null, programId: selectedProgramId, dayId: selectedDayId, programName: program.name,
        autoCreatedProgram: createdProgram, startedAt: timestamp, completedAt: null,
        status: 'active', createdAt: timestamp, updatedAt: timestamp,
      });
      const session = await this.require(id);
      if (day) for (const [position, item] of day.exercises.entries()) {
        const snapshot = await this.resolveSnapshot(item.exercise.exercise);
        const exerciseId = await this.db.adHocExercises.add({ realmId: session.realmId, owner: owner(session),
          sessionId: id, position, exercise: snapshot, notes: null, deletedAt: null });
        for (const [setPosition, set] of item.sets.entries()) {
          await this.insertSet(session, exerciseId, setPosition, set.setType ?? null);
        }
      }
      return { id, createdProgram };
    });
  }

  private async requireClientExecutionGrant(realmId: string): Promise<void> {
    if (realmId === this.actorUserId) return;
    const roles = await this.db.table<unknown>('roles').toArray();
    if (!roles.some(hasClientExecutionGrant)) throw new Error('CLIENT_EXECUTION_ACL_REQUIRED');
  }

  private async requirePlannedLifecycleGrant(realmId: string, requireFormat = false): Promise<void> {
    if (this.clientExecution) return this.requireClientExecutionGrant(realmId);
    if (realmId === this.actorUserId) return;
    const roles = await this.db.table<unknown>('roles').toArray();
    if (!roles.some(role => hasPlannedLifecycleGrant(role, 'coach', requireFormat)))
      throw new Error(requireFormat ? 'PLANNED_COACHED_START_ACL_REQUIRED' : 'PLANNED_START_ACL_REQUIRED');
  }

  /** One local transaction freezes the occurrence PLAN and creates execution.
   * Approved Coach scheduled Start; shared writes require the installed lifecycle ACL.
   */
  async createFromOccurrence(occurrenceId: string, options?: { asCoached: boolean }): Promise<{ id: string; createdProgram: false }> {
    if (typeof occurrenceId !== 'string' || !occurrenceId) throw new Error('PLANNED_WORKOUT_NOT_FOUND');
    return this.write(['workoutOccurrences', 'localWorkoutSync', 'trainingPlans', 'roles', ...catalogueTables], async () => {
      const workspace = await new WorkoutSchedulingRepository(this.db, this.actorUserId).listWorkspace();
      const occurrence = workspace.find(row => row.id === occurrenceId && row.entryKind !== 'personal_event');
      if (!occurrence || occurrence.cancelledAt || occurrence.status === 'cancelled'
        || (this.clientExecution
          ? occurrence.athleteUserId !== this.actorUserId || occurrence.publicationStatus !== 'published'
          : occurrence.coachUserId ? occurrence.coachUserId !== this.actorUserId
            : occurrence.realmId !== this.actorUserId || occurrence.athleteUserId !== this.actorUserId))
        throw new Error('PLANNED_WORKOUT_NOT_FOUND');
      const asCoached = occurrence.format === 'independent' && occurrence.athleteUserId !== this.actorUserId;
      if (asCoached && (this.clientExecution || occurrence.coachUserId !== this.actorUserId))
        throw new Error('PLANNED_WORKOUT_NOT_FOUND');
      if (asCoached && options?.asCoached !== true)
        throw new Error('PLANNED_INDEPENDENT_REQUIRES_COACHING');
      const existing = await this.getOccurrenceSession(occurrenceId, occurrence.workoutSessionId);
      if (existing) {
        if (existing.status !== 'active') throw new Error('PLANNED_WORKOUT_ALREADY_COMPLETED');
        return { id: existing.id, createdProgram: false };
      }
      if (occurrence.status !== 'scheduled' || occurrence.workoutSessionId) throw new Error('PLANNED_WORKOUT_ALREADY_STARTED');
      await this.requireNoActiveSession();
      await this.requirePlannedLifecycleGrant(occurrence.realmId, asCoached);
      const timestamp = now();
      await this.assertStartAvailable(occurrence.athleteUserId, timestamp, occurrence.id, workspace);
      const source = occurrence.trainingPlanId ? await this.db.trainingPlans.get(occurrence.trainingPlanId) : undefined;
      const programName = source?.realmId === occurrence.realmId ? source.name : 'Программа';
      const id = await this.db.adHocSessions.add({ realmId: occurrence.realmId, owner: occurrence.realmId,
        athleteUserId: occurrence.athleteUserId, coachUserId: occurrence.coachUserId, clientUserId: occurrence.clientUserId,
        creatorUserId: this.actorUserId, name: occurrence.plan.name, comment: occurrence.plan.comment,
        ...(occurrence.trainingPlanId ? { programId: occurrence.trainingPlanId, programName } : { programName: null }),
        ...(occurrence.programDayId ? { dayId: occurrence.programDayId } : {}),
        occurrenceId, occurrencePlan: structuredClone(occurrence.plan), autoCreatedProgram: false,
        startedAt: timestamp, completedAt: null, status: 'active', createdAt: timestamp, updatedAt: timestamp });
      const session = await this.require(id);
      for (const [position, item] of occurrence.plan.exercises.entries()) {
        const snapshot = await this.resolveSnapshot(item.exercise);
        const exerciseId = await this.db.adHocExercises.add({ realmId: session.realmId, owner: owner(session),
          sessionId: id, occurrenceExerciseId: item.id, position, exercise: snapshot, notes: item.notes, deletedAt: null });
        for (const [setPosition, set] of item.sets.entries()) {
          await this.db.adHocSets.add({ realmId: session.realmId, owner: owner(session), sessionId: id, exerciseId,
            occurrenceSetId: set.id, position: setPosition, deletedAt: null, ...blankFact(), setType: set.setType ?? null });
        }
      }
      await this.db.workoutOccurrences.update(occurrenceId, { status: 'in_progress', workoutSessionId: id,
        ...(asCoached ? { format: 'coached' as const } : {}),
        ...(!this.clientExecution ? { publicationStatus: 'published' as const,
          publishedPlan: structuredClone(occurrence.plan) } : {}), updatedAt: timestamp });
      await markWorkoutChanged(this.db, occurrenceId);
      return { id, createdProgram: false };
    });
  }

  /** Local readable snapshot wins over stale occurrence edits after Start. */
  async getOccurrenceSession(occurrenceId: string, linkedId?: string | null): Promise<AdHocSessionRow | null> {
    if (linkedId) {
      const linked = await this.getRow(linkedId);
      if (linked?.occurrenceId === occurrenceId) return linked;
      return null;
    }
    const rows = (await this.db.adHocSessions.toArray())
      .filter(row => isAdHocSessionRow(row) && row.occurrenceId === occurrenceId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
    for (const row of rows) if (await this.accessible(row)) return row;
    return null;
  }

  private async resolveSnapshot(snapshot: CloudProgramExerciseSnapshot): Promise<CloudWorkoutExerciseSnapshot> {
    // Definition first, immutable full snapshot fallback. Unknown tracking is an error.
    const trackingType = await this.programs.trackingTypeForExercise(snapshot)
      ?? (isExerciseTrackingType(snapshot.catalogueDefinition?.tracking_type) ? snapshot.catalogueDefinition.tracking_type : null)
      ?? (isExerciseTrackingType(snapshot.trackingType) ? snapshot.trackingType : null);
    if (!trackingType) throw new Error('ADHOC_EXERCISE_TRACKING_REQUIRED');
    const resolved = { ...structuredClone(snapshot), trackingType };
    if (!isWorkoutExerciseSnapshot(resolved)) throw new Error('ADHOC_INVALID_EXERCISE_SNAPSHOT');
    return resolved;
  }
  private insertSet(session: AdHocSessionRow, exerciseId: string, position: number,
    setType: SetType | null, previous?: AdHocSetRow): Promise<string> {
    if (setType !== null && !isSetType(setType)) throw new Error('ADHOC_INVALID_SET_TYPE');
    return this.db.adHocSets.add({ realmId: session.realmId, owner: owner(session), sessionId: session.id,
      exerciseId, position, deletedAt: null, ...blankFact(),
      ...(previous ? { actualReps: previous.actualReps, actualWeightKg: previous.actualWeightKg,
        actualDurationSeconds: previous.actualDurationSeconds, actualDistanceMeters: previous.actualDistanceMeters } : {}),
      setType });
  }

  /** Resolve the exercise card from the session snapshot, with current session access checks. */
  async exerciseInformation(sessionId: string, exerciseId: string) {
    const session = await this.getRow(sessionId);
    if (!session) throw new Error('ADHOC_SESSION_NOT_FOUND');
    const exercise = await this.exercise(session, exerciseId);
    return new ProgramManagementRepository(this.db, this.actorUserId)
      .snapshotExerciseInformation(exercise.exercise, session.realmId);
  }

  async addExercises(sessionId: string, ids: string[]): Promise<void> {
    if (!idsValid(ids)) throw new Error('ADHOC_INVALID_EXERCISE_IDS');
    await this.write(catalogueTables, async () => {
      const session = await this.require(sessionId), existing = await this.exercises(session);
      if (existing.length + ids.length > 100) throw new Error('ADHOC_TOO_MANY_EXERCISES');
      let position = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      for (const id of ids) {
        const row = await readProgramCatalogueExercise(this.db, this.actorUserId, id);
        if (!isExerciseTrackingType(row.tracking_type)) throw new Error('ADHOC_EXERCISE_TRACKING_REQUIRED');
        const snapshot = programExerciseSnapshot(row, this.actorUserId);
        // Keep tracking in the immutable private definition as well as execution metadata.
        if (snapshot.catalogueDefinition) snapshot.catalogueDefinition.tracking_type = row.tracking_type;
        const exerciseId = await this.db.adHocExercises.add({ realmId: session.realmId, owner: owner(session),
          sessionId, position: position++, notes: null, deletedAt: null,
          exercise: { ...snapshot, trackingType: row.tracking_type } });
        await this.insertSet(session, exerciseId, 0, null);
      }
      await this.touch(sessionId);
    });
  }
  async addSet(sessionId: string, exerciseId: string): Promise<void> {
    await this.write([], async () => {
      const session = await this.require(sessionId);
      await this.exercise(session, exerciseId);
      const sets = (await this.sets(session)).filter(row => row.exerciseId === exerciseId);
      if (sets.length >= 100) throw new Error('ADHOC_TOO_MANY_SETS');
      const previous = sets.at(-1);
      await this.insertSet(session, exerciseId, (previous?.position ?? -1) + 1, previous?.setType ?? null, previous);
      await this.touch(sessionId);
    });
  }
  async saveSet(sessionId: string, setId: string, fact: SetEntryFactDraft): Promise<void> {
    const patch = factPatch(fact);
    await this.write([], async () => {
      const session = await this.require(sessionId);
      await this.set(session, setId);
      await this.db.adHocSets.update(setId, patch);
      await this.touch(sessionId);
    });
  }
  async deleteSet(sessionId: string, setId: string): Promise<void> {
    await this.write([], async () => {
      const session = await this.require(sessionId);
      const set = await this.set(session, setId);
      if (session.occurrenceId && set.occurrenceSetId) throw new Error(STARTED_PLAN_MESSAGE);
      await this.db.adHocSets.update(setId, { deletedAt: now() });
      await this.touch(sessionId);
    });
  }
  async deleteExercise(sessionId: string, exerciseId: string): Promise<void> {
    await this.write([], async () => {
      const session = await this.require(sessionId);
      const exercise = await this.exercise(session, exerciseId);
      if (session.occurrenceId && exercise.occurrenceExerciseId) throw new Error(STARTED_PLAN_MESSAGE);
      const timestamp = now();
      await this.db.adHocExercises.update(exerciseId, { deletedAt: timestamp });
      for (const row of await this.sets(session)) if (row.exerciseId === exerciseId)
        await this.db.adHocSets.update(row.id, { deletedAt: timestamp });
      await this.touch(sessionId);
    });
  }
  async reorder(sessionId: string, ids: string[]): Promise<void> {
    if (!idsValid(ids, true)) throw new Error('ADHOC_INVALID_EXERCISE_IDS');
    await this.write([], async () => {
      const session = await this.require(sessionId), rows = await this.exercises(session);
      if (rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) throw new Error('ADHOC_EXERCISES_CHANGED');
      if (session.occurrenceId) {
        const frozen = rows.filter(row => row.occurrenceExerciseId);
        if (frozen.some((row, index) => ids[index] !== row.id)) throw new Error(STARTED_PLAN_MESSAGE);
      }
      for (const [position, id] of ids.entries()) if (rows.find(row => row.id === id)?.position !== position)
        await this.db.adHocExercises.update(id, { position });
      await this.touch(sessionId);
    });
  }
  async rename(sessionId: string, rawName: string): Promise<void> {
    const next = name(rawName);
    await this.write([], async () => {
      const session = await this.require(sessionId);
      if (session.occurrenceId) throw new Error(STARTED_PLAN_MESSAGE);
      await this.db.adHocSessions.update(sessionId, { name: next, updatedAt: now() });
    });
  }
  async comment(sessionId: string, rawComment: string): Promise<void> {
    const next = comment(rawComment);
    await this.write([], async () => {
      await this.require(sessionId);
      await this.db.adHocSessions.update(sessionId, { comment: next, updatedAt: now() });
    });
  }
  async complete(sessionId: string): Promise<void> {
    const initial = await this.getRow(sessionId);
    await this.write(initial?.occurrenceId ? ['workoutOccurrences', 'localWorkoutSync', 'roles'] : [], async () => {
      const row = await this.require(sessionId, false);
      if (row.status === 'completed') return;
      const timestamp = now();
      if (row.occurrenceId) {
        await this.requirePlannedLifecycleGrant(row.realmId);
        const occurrence = await this.db.workoutOccurrences.get(row.occurrenceId);
        if (!occurrence || occurrence.realmId !== row.realmId || occurrence.workoutSessionId !== row.id)
          throw new Error('PLANNED_WORKOUT_LINK_INVALID');
        await this.db.workoutOccurrences.update(occurrence.id, { status: 'completed', updatedAt: timestamp });
        await markWorkoutChanged(this.db, occurrence.id);
      }
      await this.db.adHocSessions.update(sessionId, { status: 'completed', completedAt: timestamp,
        updatedAt: timestamp, ...(row.autoCreatedProgram ? { templateSaveDecision: 'pending' as const } : {}) });
    });
  }

  async resolveTemplate(sessionId: string, save: boolean): Promise<void> {
    if (typeof save !== 'boolean') throw new Error('ADHOC_INVALID_TEMPLATE_DECISION');
    await this.write(programTables, async () => {
      const session = await this.require(sessionId, false);
      if (session.creatorUserId !== this.actorUserId || !session.autoCreatedProgram || session.status !== 'completed')
        throw new Error('ADHOC_TEMPLATE_FORBIDDEN');
      if (session.templateSaveDecision !== 'pending') {
        if (session.templateSaveDecision === (save ? 'saved' : 'declined')) return;
        throw new Error('ADHOC_TEMPLATE_ALREADY_RESOLVED');
      }
      if (save) {
        if (!session.programId || !session.dayId) throw new Error('ADHOC_TEMPLATE_TARGET_MISSING');
        const details = await this.programs.details(session.programId);
        const day = details?.days?.find(row => row.day.id === session.dayId);
        if (!day || details?.program.realmId !== session.realmId) throw new Error('ADHOC_TEMPLATE_TARGET_MISSING');
        const sets = await this.sets(session);
        const skeleton: WorkoutOccurrencePlan = { name: session.name, comment: null, exercises:
          (await this.exercises(session)).map((row, position) => ({
            id: row.id, sourceProgramExerciseId: null, position, exercise: structuredClone(row.exercise), notes: null,
            sets: sets.filter(set => set.exerciseId === row.id).map((set, setPosition) => ({
              id: set.id, sourceProgramSetId: null, position: setPosition, setType: set.setType,
              setLabel: null, comment: null, materialLinks: [], chatLinks: [],
              plannedReps: null, plannedWeightKg: null, plannedDurationSeconds: null, plannedDistanceMeters: null,
            })),
          })) };
        await this.programs.saveWorkoutAsDay(session.athleteUserId, { programId: session.programId,
          phaseId: day.day.programPhaseId, dayId: session.dayId, name: session.name,
          expected: snapshotProgramDay(day) }, skeleton);
      }
      await this.db.adHocSessions.update(sessionId, { templateSaveDecision: save ? 'saved' : 'declined', updatedAt: now() });
    });
  }

  private async project(session: AdHocSessionRow): Promise<ActiveWorkoutSession<string>> {
    const sets = await this.sets(session);
    const planned = session.occurrenceId ? await this.db.workoutOccurrences.get(session.occurrenceId) : null;
    const plannedTiming = planned && planned.realmId === session.realmId && planned.workoutSessionId === session.id
      ? { startsAtUtc: planned.startsAtUtc, durationMinutes: planned.durationMinutes } : undefined;
    return {
      ...(plannedTiming ? { plannedTiming } : {}),
      format: planned && planned.realmId === session.realmId && planned.workoutSessionId === session.id
        ? planned.format : session.coachUserId ? 'coached' : 'independent',
      sessionId: session.id, occurrenceId: session.occurrenceId ?? null, status: session.status,
      workoutDate: localWorkoutDate(session.startedAt), startedAt: session.startedAt, completedAt: session.completedAt,
      program: session.programId ? { id: session.programId, name: session.programName ?? '' } : null,
      phase: null, day: session.dayId ? { id: session.dayId, name: session.name, position: 0 } : null,
      exercises: (await this.exercises(session)).map((row): SessionExerciseData<string> => {
        if (!isWorkoutExerciseSnapshot(row.exercise)) throw new Error('ADHOC_INVALID_EXERCISE_SNAPSHOT');
        const exerciseSets = sets.filter(set => set.exerciseId === row.id);
        const plannedExercise = session.occurrencePlan?.exercises.find(item => item.id === row.occurrenceExerciseId);
        return { sessionExerciseId: row.id, workoutSessionId: session.id, sourceProgramExerciseId: null,
          position: row.position, status: exerciseSets.length > 0 && exerciseSets.every(set => set.setStatus !== 'pending')
            ? 'completed' : 'active', notes: row.notes, mediaUrl: row.exercise.mediaUrl,
          exercise: { id: row.exercise.exerciseDefinitionId, scope: row.exercise.scope === 'public' ? 'global' : row.exercise.scope, name: row.exercise.name,
            description: null, tracking_type: row.exercise.trackingType, category_code: null, equipment_code: null,
            reference_source: null, reference_key: null, reference_media_url: row.exercise.mediaUrl,
            is_favourite: false, can_edit: false },
          sets: exerciseSets.map((set): SessionExerciseSetData<string> => {
            const prescription = plannedExercise?.sets.find(item => item.id === set.occurrenceSetId);
            return { sessionSetId: set.id, sourceProgramSetId: prescription?.sourceProgramSetId ?? null, position: set.position,
              status: set.setStatus, setType: set.setType,
              plan: prescription ? { reps: prescription.plannedReps, weightKg: prescription.plannedWeightKg,
                durationSeconds: prescription.plannedDurationSeconds, distanceMeters: prescription.plannedDistanceMeters } : null,
              previous: null, fact: factOf(set) };
          }),
        };
      }),
    };
  }
  async get(id: string): Promise<ActiveWorkoutSession<string> | null> {
    return this.db.transaction('r', [...executionTables, 'workoutOccurrences'], async () => {
      const row = await this.getRow(id);
      return row ? this.project(row) : null;
    });
  }
  observe(id: string, onChange: (session: ActiveWorkoutSession<string> | null, row?: AdHocSessionRow, issue?: AdHocSessionAccessIssue) => void,
    onError: (reason: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.db.transaction('r', [...executionTables, 'workoutOccurrences'], async () => {
      const row = await this.db.adHocSessions.get(id);
      const issue: AdHocSessionAccessIssue | null = row ? await this.accessIssue(row) : 'ADHOC_LOCAL_RECORD_MISSING';
      if (issue || !row) return { session: null, row: undefined, issue: issue ?? undefined };
      return { session: await this.project(row), row, issue: undefined };
    })).subscribe({ next: result => onChange(result.session, result.row, result.issue), error: onError });
  }

  /** Client-visible active FACT sessions from authorized Coach/Client realms only.
   * Never infer access from athleteUserId alone: validate the realm membership
   * before exposing headers to a Client subscriber.
   */
  async listForClient(): Promise<AdHocOpenSession[]> {
    const rows = await this.db.adHocSessions.where('athleteUserId').equals(this.actorUserId).toArray();
    const visible: AdHocSessionRow[] = [];
    for (const row of rows) {
      if (!isAdHocSessionRow(row) || row.status !== 'active'
        || row.clientUserId !== this.actorUserId || row.creatorUserId === this.actorUserId) continue;
      if (await this.accessible(row)) visible.push(row);
    }
    return visible.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .map(row => ({ id: row.id, name: row.name, status: row.status }));
  }

  observeForClient(onChange: (rows: AdHocOpenSession[]) => void,
    onError: (reason: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.listForClient()).subscribe({ next: onChange, error: onError });
  }

  /** Called in the creation transaction so competing local starts serialize. */
  private async findActive(): Promise<{ id: string; name: string } | null> {
    const rows = await this.db.adHocSessions.where('status').equals('active').toArray();
    for (const row of rows) if ((this.clientExecution ? row.athleteUserId === this.actorUserId
      : row.creatorUserId === this.actorUserId) && await this.accessible(row))
      return { id: row.id, name: row.name };
    return null;
  }
  getActive(): Promise<{ id: string; name: string } | null> {
    return this.db.transaction('r', executionTables, async () => this.findActive());
  }
  private async requireNoActiveSession(): Promise<void> {
    if (await this.findActive()) throw new Error('ADHOC_ACTIVE_SESSION_EXISTS');
  }
  async list(): Promise<AdHocOpenSession[]> {
    const result: AdHocOpenSession[] = [];
    const rows = (await this.db.adHocSessions.toArray()).filter(isAdHocSessionRow).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
    for (const row of rows) if ((this.clientExecution ? row.athleteUserId === this.actorUserId
      : row.creatorUserId === this.actorUserId)
      && (row.status === 'active' || (!this.clientExecution && row.status === 'completed' && row.autoCreatedProgram && row.templateSaveDecision === 'pending'))
      && await this.accessible(row)) result.push({ id: row.id, name: row.name, status: row.status });
    return result;
  }
  observeOpen(onChange: (rows: AdHocOpenSession[]) => void,
    onError: (reason: unknown) => void): { unsubscribe(): void } {
    return liveQuery(() => this.list()).subscribe({ next: onChange, error: onError });
  }
}
