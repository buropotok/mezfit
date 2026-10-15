import { liveQuery } from 'dexie';
import { isApprovedAssignedPair, sortAssignedPlans } from './assigned-programs';
import { isExpectedPlanOwner, isExpectedPhaseOwner } from './program-ownership';
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
    && (value.owner === null || (typeof value.owner === 'string' && value.owner.length > 0))
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
    && (value.owner === null || (typeof value.owner === 'string' && value.owner.length > 0))
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
/** Activation exclusivity belongs to one relationship realm, not every coach of an athlete. */
export function isOtherActiveProgramInScope(
  candidate: CloudTrainingPlanRow,
  target: CloudTrainingPlanRow,
): boolean {
  return candidate.id !== target.id && candidate.realmId === target.realmId
    && athleteOf(candidate) === athleteOf(target) && candidate.status === 'active';
}
/** A client's assigned PLAN must belong to the currently selected coach. */
export function selectedCoachActiveProgram(
  programs: readonly CloudTrainingPlanRow[],
  athleteUserId: string,
  coachUserId: string,
): CloudTrainingPlanRow | undefined {
  return programs.find((plan) => plan.status === 'active'
    && plan.clientUserId === athleteUserId && plan.coachUserId === coachUserId);
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
  return phase.trainingPlanId === plan.id && phase.realmId === plan.realmId
    && isExpectedPhaseOwner(phase, plan);
}

/** Local-first PLAN authoring: ownerless legacy or addon-owned author headers. */
export class ProgramManagementRepository {
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {}

  private own(plan: CloudTrainingPlanRow): boolean {
    return plan.realmId === this.actorUserId && plan.athleteUserId === this.actorUserId
      && plan.coachUserId === null && plan.clientUserId === null
      && isExpectedPlanOwner(plan);
  }
  private async readable(plan: CloudTrainingPlanRow): Promise<boolean> {
    if (!isCloudPlanRow(plan) || !isExpectedPlanOwner(plan)) return false;
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
  async listPersonal(): Promise<CloudTrainingPlanRow[]> {
    return (await this.listReadable()).filter((plan) => this.own(plan));
  }
  observePersonal(onChange: (rows: CloudTrainingPlanRow[]) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.listPersonal()).subscribe({ next: onChange, error: onError });
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

  /** Client projection owns Dexie subscription and never exposes draft-only programs. */
  observeActiveForAthlete(
    athleteUserId: string,
    coachUserId: string,
    onChange: (data: ProgramDetails | null) => void,
    onError: (reason: unknown) => void,
  ) {
    if (athleteUserId !== this.actorUserId) {
      throw new Error('Чужая программа недоступна');
    }
    return liveQuery(async () => {
      const plans = await this.listReadable();
      const active = selectedCoachActiveProgram(plans, athleteUserId, coachUserId);
      if (!active) return null;
      const details = await this.details(active.id);
      return details ? { ...details, phases: clientVisiblePhases(details.phases) } : null;
    }).subscribe({ next: onChange, error: onError });
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
      const wasActive = phase.status === 'active';
      await this.db.programPhases.update(phaseId, { status });
      if (wasActive && current.status === 'active') {
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
      // The indexed relationship is replayed against the server's current snapshot
      // and also affects phases that another offline client created or activated.
      await this.db.programPhases.where('[trainingPlanId+status]').equals([id, 'active'])
        .modify({ status });
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
    // Client prompts use locally visible state; the actual mutation below does
    // not rely on which other program / phase IDs were present in that snapshot.
    const other = (await this.listReadable()).find((p) =>
      isOtherActiveProgramInScope(p, plan));
    if (other) {
      await this.author(other);
      if (!options.previousProgramStatus) throw new Error('PREVIOUS_PROGRAM_STATUS_REQUIRED');
    }
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.db.trainingPlans.get(id);
      const target = await this.db.programPhases.get(phaseId);
      if (!current || !target || current.realmId !== plan.realmId || !belongs(target, current))
        throw new Error('Фаза программы не найдена');

      const activePhases = await this.db.programPhases
        .where('[trainingPlanId+status]').equals([id, 'active']).toArray();
      if (activePhases.some((phase) => phase.id !== phaseId) && !options.previousPhaseStatus)
        throw new Error('PREVIOUS_PHASE_STATUS_REQUIRED');

      const now = new Date().toISOString();
      // Both where predicates are intentionally declarative: Dexie Cloud
      // replays them against the server's canonical state, unlike bulk ID updates.
      // A hidden concurrent activation uses 'draft' as the safe fallback rather
      // than inaccurately claiming that an unseen program was completed.
      const priorPhaseStatus = options.previousPhaseStatus ?? 'draft';
      const priorProgramStatus = options.previousProgramStatus ?? 'draft';
      await this.db.programPhases.where('[trainingPlanId+status]').equals([id, 'active'])
        .modify({ status: priorPhaseStatus });
      await this.db.programPhases.where('[realmId+status]').equals([current.realmId, 'active'])
        .modify({ status: priorProgramStatus });
      await this.db.trainingPlans.where('[realmId+status]').equals([current.realmId, 'active'])
        .modify({
          status: priorProgramStatus,
          updatedAt: now,
          finishedAt: priorProgramStatus === 'finished' ? now : null,
        });
      await this.db.programPhases.update(phaseId, { status: 'active' });
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
  /** This PR can duplicate phase headers only; descendant ACL comes with day authoring. */
  private async copyPhase(source: CloudProgramPhaseRow, planId: string, position: number) {
    return this.db.programPhases.add({
      realmId: source.realmId, owner: null, trainingPlanId: planId,
      name: source.name, position, status: 'draft',
      durationWeeks: source.durationWeeks ?? DEFAULT_PHASE_WEEKS,
      plannedStartDate: source.plannedStartDate, plannedEndDate: source.plannedEndDate,
    });
  }

  async duplicatePhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
        const tree = await this.tree(plan), source = tree.phases.find((phase) => phase.id === phaseId);
        if (!source) throw new Error('Фаза не найдена');
        if (tree.days.some((day) => day.programPhaseId === phaseId))
          throw new Error('Дублирование фазы с днями будет доступно после реализации редактора дней');
        await this.copyPhase(source, id,
          tree.phases.reduce((max, phase) => Math.max(max, phase.position), -1) + 1);
      });
  }
  async duplicateProgram(id: string): Promise<string> {
    const plan = await this.writable(id);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
        const tree = await this.tree(plan);
        if (tree.days.length > 0)
          throw new Error('Дублирование программы с днями будет доступно после реализации редактора дней');
        const plans = await this.db.trainingPlans.where('realmId').equals(plan.realmId).toArray();
        const now = new Date().toISOString();
        const nextId = await this.db.trainingPlans.add({
          realmId: plan.realmId, owner: null, athleteUserId: athleteOf(plan) ?? undefined,
          coachUserId: plan.coachUserId, clientUserId: plan.clientUserId,
          name: validName(`${plan.name.slice(0, 111)} (копия)`),
          position: plans.reduce((max, row) => Math.max(max, row.position), -1) + 1,
          status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
        });
        for (const phase of tree.phases) await this.copyPhase(phase, nextId, phase.position);
        return nextId;
      });
  }
  async deletePhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['programPhases', 'programDays',
      'programExercises', 'programSets', 'workoutOccurrences'], async () => {
      const phase = await this.db.programPhases.get(phaseId);
      if (!phase || !belongs(phase, plan)) throw new Error('Фаза не найдена');
      if (phase.status === 'active') throw new Error('Сначала смените статус активной фазы');
      const tree = await this.tree(plan);
      if (tree.days.some((day) => day.programPhaseId === phaseId))
        throw new Error('Нельзя удалить фазу с днями до реализации синхронизируемого каскада');
      // A collection predicate survives late syncs, unlike deleting locally known IDs.
      await this.db.programPhases.where('id').equals(phaseId).delete();
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
        if (tree.days.length > 0)
          throw new Error('Нельзя удалить программу с днями до реализации синхронизируемого каскада');
        // Dexie Cloud replays these parent predicates even for phases added while
        // this device was offline. Child days are deliberately outside this PR's
        // write permissions and prevent deletion entirely if present.
        await this.db.programPhases.where('trainingPlanId').equals(id).delete();
        await this.db.trainingPlans.where('id').equals(id).delete();
      });
  }

}
