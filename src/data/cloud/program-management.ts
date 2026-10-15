import { liveQuery } from 'dexie';
import { isApprovedAssignedPair, sortAssignedPlans } from './assigned-programs';
import type { CloudProgramStatus, CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import type { CloudProgramPhaseRow } from './workout-foundation-types';

export type PhaseStatus = CloudProgramPhaseRow['status'];
export type InactiveStatus = Exclude<CloudProgramStatus, 'active'>;
export type ProgramDetails = { program: CloudTrainingPlanRow; phases: CloudProgramPhaseRow[] };
export const DEFAULT_PHASE_WEEKS = 10;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const PROGRAM_STATUSES: readonly string[] = ['draft', 'active', 'finished', 'cancelled'];
const PHASE_STATUSES: readonly string[] = ['draft', 'pending', 'active', 'finished', 'cancelled'];
export function isCloudPlanRow(value: unknown): value is CloudTrainingPlanRow {
  if (!record(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.realmId === 'string' && value.realmId.length > 0
    && value.owner === null
    && typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.status === 'string' && PROGRAM_STATUSES.includes(value.status)
    && typeof value.position === 'number' && Number.isSafeInteger(value.position) && value.position >= 0
    && (value.coachUserId === null || typeof value.coachUserId === 'string')
    && (value.clientUserId === null || typeof value.clientUserId === 'string')
    && (value.athleteUserId === undefined || typeof value.athleteUserId === 'string')
    && (value.startedAt === null || typeof value.startedAt === 'string')
    && (value.finishedAt === null || typeof value.finishedAt === 'string')
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}
export function isCloudPhaseRow(value: unknown): value is CloudProgramPhaseRow {
  if (!record(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0
    && typeof value.realmId === 'string' && value.realmId.length > 0
    && value.owner === null
    && typeof value.trainingPlanId === 'string' && value.trainingPlanId.length > 0
    && typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.position === 'number' && Number.isSafeInteger(value.position) && value.position >= 0
    && typeof value.status === 'string' && PHASE_STATUSES.includes(value.status)
    && (value.durationWeeks === undefined
      || (typeof value.durationWeeks === 'number' && isValidDurationWeeks(value.durationWeeks)))
    && (value.plannedStartDate === null || typeof value.plannedStartDate === 'string')
    && (value.plannedEndDate === null || typeof value.plannedEndDate === 'string');
}

export function athleteOf(plan: CloudTrainingPlanRow): string | null {
  return plan.athleteUserId ?? plan.clientUserId;
}
export function clientVisiblePhases(phases: readonly CloudProgramPhaseRow[]): CloudProgramPhaseRow[] {
  return phases.filter((phase) => phase.status !== 'draft');
}
export function isValidDurationWeeks(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
function validName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 120) throw new Error('Название должно содержать от 1 до 120 символов');
  return name;
}
function ordered<T extends { id: string; position: number }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}
function belongs(phase: CloudProgramPhaseRow, plan: CloudTrainingPlanRow): boolean {
  return phase.trainingPlanId === plan.id && phase.realmId === plan.realmId && phase.owner === null;
}

/** Single local-first PLAN owner. Shared rows remain owner:null for server role enforcement. */
export class ProgramManagementRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {}

  private own(plan: CloudTrainingPlanRow): boolean {
    return plan.realmId === this.actorUserId && plan.athleteUserId === this.actorUserId
      && plan.coachUserId === null && plan.clientUserId === null && plan.owner === null;
  }
  private async readable(plan: CloudTrainingPlanRow): Promise<boolean> {
    if (!isCloudPlanRow(plan)) return false;
    if (this.own(plan)) return true;
    if (!plan.coachUserId || !plan.clientUserId ||
      (plan.coachUserId !== this.actorUserId && plan.clientUserId !== this.actorUserId)) return false;
    const [realm, members] = await Promise.all([
      this.db.realms.get(plan.realmId),
      this.db.members.where('realmId').equals(plan.realmId).toArray(),
    ]);
    return isApprovedAssignedPair(realm, members, plan.coachUserId, plan.clientUserId);
  }
  private async author(plan: CloudTrainingPlanRow): Promise<void> {
    if (!await this.readable(plan) || (!this.own(plan) && plan.coachUserId !== this.actorUserId))
      throw new Error('Недостаточно прав для редактирования программы');
  }
  private async writable(id: string): Promise<CloudTrainingPlanRow> {
    const plan = await this.db.trainingPlans.get(id);
    if (!plan) throw new Error('Программа не найдена');
    await this.author(plan);
    return plan;
  }

  async listReadable(): Promise<CloudTrainingPlanRow[]> {
    const list = await Promise.all((await this.db.trainingPlans.toArray())
      .map(async plan => await this.readable(plan) ? plan : null));
    return sortAssignedPlans(list.filter((plan): plan is CloudTrainingPlanRow => plan !== null));
  }
  async listAuthored(): Promise<CloudTrainingPlanRow[]> {
    return (await this.listReadable()).filter((plan) => this.own(plan) || plan.coachUserId === this.actorUserId);
  }
  observeAuthored(onChange: (rows: CloudTrainingPlanRow[]) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.listAuthored()).subscribe({ next: onChange, error: onError });
  }
  async details(id: string): Promise<ProgramDetails | null> {
    const plan = await this.db.trainingPlans.get(id);
    if (!plan || !await this.readable(plan)) return null;
    const candidatePhases = await this.db.programPhases.where('trainingPlanId').equals(id).toArray();
    for (const phase of candidatePhases) {
      if (phase.realmId === plan.realmId && !isCloudPhaseRow(phase))
        throw new Error('INVALID_CLOUD_PROGRAM_PHASE');
    }
    const phases = candidatePhases
      .filter((phase) => belongs(phase, plan))
      .map((phase) => ({
        ...phase,
        durationWeeks: isValidDurationWeeks(phase.durationWeeks ?? 0)
          ? phase.durationWeeks : DEFAULT_PHASE_WEEKS,
      }));
    return { program: plan, phases: ordered(phases) };
  }
  observeDetails(id: string, onChange: (data: ProgramDetails | null) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.details(id)).subscribe({ next: onChange, error: onError });
  }

  async createPersonal(rawName: string): Promise<string> {
    const name = validName(rawName), now = new Date().toISOString();
    const position = await this.db.trainingPlans.where('realmId').equals(this.actorUserId).count();
    // Built-in personal Dexie Cloud realm uses the authenticated user's cloud ID.
    return this.db.trainingPlans.add({
      realmId: this.actorUserId, owner: null, athleteUserId: this.actorUserId,
      coachUserId: null, clientUserId: null, name, position,
      status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
    });
  }
  async createAssigned(athleteUserId: string, rawName: string): Promise<string> {
    const name = validName(rawName);
    if (!/^tg:[1-9]\d*$/.test(athleteUserId) || athleteUserId === this.actorUserId)
      throw new Error('Некорректный атлет');
    const [realms, members] = await Promise.all([this.db.realms.toArray(), this.db.members.toArray()]);
    let realmId: string | null = null;
    for (const realm of realms) {
      if (await isApprovedAssignedPair(realm, members.filter((m) => m.realmId === realm.realmId),
        this.actorUserId, athleteUserId)) { realmId = realm.realmId; break; }
    }
    if (!realmId) throw new Error('Связь с атлетом ещё не синхронизирована');
    const position = await this.db.trainingPlans.where('realmId').equals(realmId).count();
    const now = new Date().toISOString();
    return this.db.trainingPlans.add({
      realmId, owner: null, athleteUserId, coachUserId: this.actorUserId, clientUserId: athleteUserId,
      name, position, status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
    });
  }
  async renameProgram(id: string, name: string): Promise<void> {
    await this.writable(id);
    await this.db.trainingPlans.update(id, { name: validName(name), updatedAt: new Date().toISOString() });
  }
  async renamePhase(id: string, phaseId: string, name: string): Promise<void> {
    const plan = await this.writable(id), phase = await this.db.programPhases.get(phaseId);
    if (!phase || !belongs(phase, plan)) throw new Error('Фаза не найдена');
    await this.db.programPhases.update(phaseId, { name: validName(name) });
  }
  async duration(id: string, phaseId: string, weeks: number): Promise<void> {
    if (!isValidDurationWeeks(weeks)) throw new Error('Укажите положительное целое количество недель');
    const plan = await this.writable(id), phase = await this.db.programPhases.get(phaseId);
    if (!phase || !belongs(phase, plan)) throw new Error('Фаза не найдена');
    await this.db.programPhases.update(phaseId, { durationWeeks: weeks });
  }
  async createPhase(id: string): Promise<string> {
    const plan = await this.writable(id);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.db.trainingPlans.get(id);
      if (!current || current.realmId !== plan.realmId) throw new Error('Программа изменилась');
      const phases = await this.db.programPhases.where('trainingPlanId').equals(id).toArray();
      const used = new Set(phases.map((phase) => phase.name));
      let n = 1;
      while (used.has(`Фаза ${n}`)) n++;
      return this.db.programPhases.add({
        realmId: plan.realmId, owner: null, trainingPlanId: id,
        name: `Фаза ${n}`, status: 'draft', durationWeeks: DEFAULT_PHASE_WEEKS,
        position: phases.reduce((max, phase) => Math.max(max, phase.position), -1) + 1,
        plannedStartDate: null, plannedEndDate: null,
      });
    });
  }
  async publishPhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['programPhases'], async () => {
      const phase = await this.db.programPhases.get(phaseId);
      if (!phase || !belongs(phase, plan) || phase.status !== 'draft')
        throw new Error('Завершить заполнение можно только у черновика');
      await this.db.programPhases.update(phaseId, { status: 'pending' });
    });
  }
  async setPhaseStatus(id: string, phaseId: string, status: Exclude<PhaseStatus, 'active'>): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const phase = await this.db.programPhases.get(phaseId);
      const current = await this.db.trainingPlans.get(id);
      if (!phase || !current || !belongs(phase, current) || current.realmId !== plan.realmId)
        throw new Error('Фаза не найдена');
      await this.db.programPhases.update(phaseId, { status });
      if (phase.status === 'active' && current.status === 'active') {
        // pending has no program equivalent: the parent becomes a draft.
        const nextProgramStatus: CloudProgramStatus = status === 'pending' ? 'draft' : status;
        await this.db.trainingPlans.update(id, {
          status: nextProgramStatus, updatedAt: new Date().toISOString(),
          finishedAt: status === 'finished' ? new Date().toISOString() : null,
        });
      }
    });
  }
  async setProgramStatus(id: string, status: InactiveStatus): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.db.trainingPlans.get(id);
      if (!current || current.realmId !== plan.realmId) throw new Error('Программа изменилась');
      for (const phase of await this.db.programPhases.where('trainingPlanId').equals(id).toArray()) {
        if (belongs(phase, current) && phase.status === 'active')
          await this.db.programPhases.update(phase.id, { status });
      }
      const now = new Date().toISOString();
      await this.db.trainingPlans.update(id, {
        status, updatedAt: now, finishedAt: status === 'finished' ? now : null,
      });
    });
  }
  async activate(id: string, phaseId: string, options: {
    previousPhaseStatus?: 'draft' | 'finished' | 'cancelled';
    previousProgramStatus?: InactiveStatus;
  } = {}): Promise<void> {
    const plan = await this.writable(id);
    const other = (await this.listReadable()).find((p) =>
      p.id !== id && p.status === 'active' && athleteOf(p) === athleteOf(plan));
    if (other) {
      await this.author(other);
      if (!options.previousProgramStatus) throw new Error('PREVIOUS_PROGRAM_STATUS_REQUIRED');
    }
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.db.trainingPlans.get(id), target = await this.db.programPhases.get(phaseId);
      if (!current || !target || current.realmId !== plan.realmId || !belongs(target, current))
        throw new Error('Фаза программы не найдена');
      const activeOthers = (await this.db.trainingPlans.toArray()).filter((p) =>
        p.id !== id && p.status === 'active' && athleteOf(p) === athleteOf(current));
      if (activeOthers.some((p) => p.id !== other?.id))
        throw new Error('Активная программа изменилась');
      if (other) {
        const previousStatus = options.previousProgramStatus;
        if (!previousStatus) throw new Error('PREVIOUS_PROGRAM_STATUS_REQUIRED');
        const previous = await this.db.trainingPlans.get(other.id);
        if (!previous || previous.status !== 'active') throw new Error('Активная программа изменилась');
        for (const phase of await this.db.programPhases.where('trainingPlanId').equals(other.id).toArray())
          if (belongs(phase, previous) && phase.status === 'active')
            await this.db.programPhases.update(phase.id, { status: previousStatus });
        await this.db.trainingPlans.update(other.id, {
          status: previousStatus,
          updatedAt: new Date().toISOString(),
          finishedAt: previousStatus === 'finished' ? new Date().toISOString() : null,
        });
      }
      const active = (await this.db.programPhases.where('trainingPlanId').equals(id).toArray())
        .filter((phase) => belongs(phase, current) && phase.status === 'active' && phase.id !== phaseId);
      if (active.length > 0 && !options.previousPhaseStatus)
        throw new Error('PREVIOUS_PHASE_STATUS_REQUIRED');
      for (const phase of active) {
        const previousStatus = options.previousPhaseStatus;
        if (!previousStatus) throw new Error('PREVIOUS_PHASE_STATUS_REQUIRED');
        await this.db.programPhases.update(phase.id, { status: previousStatus });
      }
      await this.db.programPhases.update(phaseId, { status: 'active' });
      const now = new Date().toISOString();
      await this.db.trainingPlans.update(id, {
        status: 'active', startedAt: current.startedAt ?? now, finishedAt: null, updatedAt: now,
      });
    });
  }

  /** Collect only same-realm descendants for safe deep copy / deletion. */
  private async tree(plan: CloudTrainingPlanRow) {
    const phases = (await this.db.programPhases.where('trainingPlanId').equals(plan.id).toArray())
      .filter((phase) => belongs(phase, plan));
    const days = (await this.db.programDays.where('realmId').equals(plan.realmId).toArray())
      .filter((day) => day.owner === null && phases.some((phase) => phase.id === day.programPhaseId));
    const exercises = (await this.db.programExercises.where('realmId').equals(plan.realmId).toArray())
      .filter((exercise) => exercise.owner === null && days.some((day) => day.id === exercise.programDayId));
    const sets = (await this.db.programSets.where('realmId').equals(plan.realmId).toArray())
      .filter((set) => set.owner === null && exercises.some((exercise) => exercise.id === set.programExerciseId));
    return { phases: ordered(phases), days, exercises, sets };
  }
  private async copyPhase(source: CloudProgramPhaseRow, planId: string, position: number,
    tree: Awaited<ReturnType<ProgramManagementRepository['tree']>>) {
    const phaseId = await this.db.programPhases.add({
      realmId: source.realmId, owner: null, trainingPlanId: planId,
      name: source.name, position, status: 'draft', durationWeeks: source.durationWeeks ?? DEFAULT_PHASE_WEEKS,
      plannedStartDate: source.plannedStartDate, plannedEndDate: source.plannedEndDate,
    });
    for (const day of ordered(tree.days.filter((row) => row.programPhaseId === source.id))) {
      const dayId = await this.db.programDays.add({
        realmId: day.realmId, owner: null, programPhaseId: phaseId,
        position: day.position, name: day.name, status: day.status,
      });
      for (const exercise of ordered(tree.exercises.filter((row) => row.programDayId === day.id))) {
        const exerciseId = await this.db.programExercises.add({
          realmId: exercise.realmId, owner: null, programDayId: dayId,
          position: exercise.position, status: exercise.status, notes: exercise.notes,
          exercise: { ...exercise.exercise },
        });
        for (const set of ordered(tree.sets.filter((row) => row.programExerciseId === exercise.id)))
          await this.db.programSets.add({
            realmId: set.realmId, owner: null, programExerciseId: exerciseId,
            position: set.position, status: set.status,
            plannedReps: set.plannedReps, plannedWeightKg: set.plannedWeightKg,
            plannedDurationSeconds: set.plannedDurationSeconds, plannedDistanceMeters: set.plannedDistanceMeters,
          });
      }
    }
  }
  async duplicatePhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
        const tree = await this.tree(plan), source = tree.phases.find((phase) => phase.id === phaseId);
        if (!source) throw new Error('Фаза не найдена');
        await this.copyPhase(source, id, tree.phases.reduce((max, phase) => Math.max(max, phase.position), -1) + 1, tree);
      });
  }
  async duplicateProgram(id: string): Promise<string> {
    const plan = await this.writable(id);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
        const tree = await this.tree(plan);
        const plans = await this.db.trainingPlans.where('realmId').equals(plan.realmId).toArray();
        const now = new Date().toISOString();
        const nextId = await this.db.trainingPlans.add({
          realmId: plan.realmId, owner: null, athleteUserId: athleteOf(plan) ?? undefined,
          coachUserId: plan.coachUserId, clientUserId: plan.clientUserId,
          name: validName(`${plan.name.slice(0, 111)} (копия)`),
          position: plans.reduce((max, row) => Math.max(max, row.position), -1) + 1,
          status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
        });
        for (const phase of tree.phases) await this.copyPhase(phase, nextId, phase.position, tree);
        return nextId;
      });
  }
  async deletePhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['programPhases', 'programDays', 'programExercises',
      'programSets', 'workoutOccurrences'], async () => {
        const phase = await this.db.programPhases.get(phaseId);
        if (!phase || !belongs(phase, plan)) throw new Error('Фаза не найдена');
        if (phase.status === 'active') throw new Error('Сначала смените статус активной фазы');
        const tree = await this.tree(plan);
        const days = tree.days.filter((day) => day.programPhaseId === phaseId);
        if ((await this.db.workoutOccurrences.where('realmId').equals(plan.realmId).toArray())
          .some((occ) => days.some((day) => day.id === occ.programDayId)))
          throw new Error('Фаза уже содержит запланированные тренировки');
        const exercises = tree.exercises.filter((exercise) => days.some((day) => day.id === exercise.programDayId));
        await this.db.programSets.bulkDelete(tree.sets.filter((set) => exercises.some((exercise) =>
          exercise.id === set.programExerciseId)).map((set) => set.id));
        await this.db.programExercises.bulkDelete(exercises.map((row) => row.id));
        await this.db.programDays.bulkDelete(days.map((row) => row.id));
        await this.db.programPhases.delete(phaseId);
      });
  }
  async deleteProgram(id: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'programExercises', 'programSets', 'workoutOccurrences', 'workoutSessions'],
      async () => {
        const current = await this.db.trainingPlans.get(id);
        if (!current || current.realmId !== plan.realmId || current.owner !== null)
          throw new Error('Программа изменилась. Повторите действие.');
        if (current.status === 'active') throw new Error('Сначала смените статус активной программы');
        if (await this.db.workoutSessions.where('trainingPlanId').equals(id).count())
          throw new Error('Программу с историей тренировок удалять нельзя');
        const tree = await this.tree(current);
        if ((await this.db.workoutOccurrences.where('realmId').equals(plan.realmId).toArray())
          .some((occ) => tree.days.some((day) => day.id === occ.programDayId)))
          throw new Error('Программа уже содержит запланированные тренировки');
        await this.db.programSets.bulkDelete(tree.sets.map((row) => row.id));
        await this.db.programExercises.bulkDelete(tree.exercises.map((row) => row.id));
        await this.db.programDays.bulkDelete(tree.days.map((row) => row.id));
        await this.db.programPhases.bulkDelete(tree.phases.map((row) => row.id));
        await this.db.trainingPlans.delete(id);
      });
  }
}
