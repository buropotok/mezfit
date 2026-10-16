import { liveQuery } from 'dexie';
import { isApprovedAssignedPair, sortAssignedPlans } from './assigned-programs';
import { isExpectedPlanOwner, isExpectedPhaseOwner } from './program-ownership';
import type { CloudProgramStatus, CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import { belongsToPlan, orderedPlanRows, readProgramDays } from './program-day-tree';
import type { CloudProgramDayOutline, CloudProgramDayRow, CloudProgramPhaseRow } from './workout-foundation-types';

export type PhaseStatus = CloudProgramPhaseRow['status'];
export type InactiveStatus = Exclude<CloudProgramStatus, 'active'>;
export type ProgramDetails = { program: CloudTrainingPlanRow; phases: CloudProgramPhaseRow[]; days?: CloudProgramDayOutline[] };
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
    && (value.deletedAt == null || typeof value.deletedAt === 'string')
    && typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.status === 'string' && PROGRAM_STATUSES.includes(value.status)
    && typeof value.position === 'number' && Number.isSafeInteger(value.position) && value.position >= 0
    && (value.coachUserId === null || typeof value.coachUserId === 'string')
    && (value.clientUserId === null || typeof value.clientUserId === 'string')
    && (value.athleteUserId === undefined
      || (typeof value.athleteUserId === 'string' && value.athleteUserId.length > 0))
    // Legacy assigned rows may omit athleteUserId. An explicit value must
    // match the relationship client; otherwise active-program scope diverges.
    && (value.clientUserId === null || value.athleteUserId === undefined
      || value.athleteUserId === value.clientUserId)
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
    && (value.deletedAt == null || typeof value.deletedAt === 'string')
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
    if (!isCloudPlanRow(plan) || plan.deletedAt || !isExpectedPlanOwner(plan)) return false;
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
    if (!plan || plan.deletedAt) throw new Error('Программа не найдена');
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
  /** Personal authoring and every published assignment, across all connected coaches. */
  async listForAthlete(): Promise<CloudTrainingPlanRow[]> {
    return (await this.listReadable()).filter((plan) => this.own(plan)
      || (plan.clientUserId === this.actorUserId && plan.status !== 'draft'));
  }
  observeForAthlete(onChange: (rows: CloudTrainingPlanRow[]) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.listForAthlete()).subscribe({ next: onChange, error: onError });
  }
  async athleteDetails(id: string): Promise<ProgramDetails | null> {
    const details = await this.details(id);
    if (!details) return null;
    if (this.own(details.program)) return details;
    if (details.program.clientUserId !== this.actorUserId || details.program.status === 'draft') return null;
    const phases = clientVisiblePhases(details.phases);
    const phaseIds = new Set(phases.map((phase) => phase.id));
    return { ...details, phases, days: details.days?.filter((row) => phaseIds.has(row.day.programPhaseId)) };
  }
  observeAthleteDetails(id: string, onChange: (data: ProgramDetails | null) => void, onError: (reason: unknown) => void) {
    return liveQuery(() => this.athleteDetails(id)).subscribe({ next: onChange, error: onError });
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
      .filter((phase) => !phase.deletedAt && belongs(phase, plan))
      .map((phase) => ({
        ...phase,
        durationWeeks: isValidDurationWeeks(phase.durationWeeks ?? 0)
          ? phase.durationWeeks : DEFAULT_PHASE_WEEKS,
      }));
    const sorted = ordered(phases);
    return { program: plan, phases: sorted, days: await readProgramDays(this.db, plan, sorted) };
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
      if (!details) return null;
      const phases = clientVisiblePhases(details.phases);
      const phaseIds = new Set(phases.map((phase) => phase.id));
      return { ...details, phases, days: details.days?.filter((row) => phaseIds.has(row.day.programPhaseId)) };
    }).subscribe({ next: onChange, error: onError });
  }

  async createPersonal(rawName: string): Promise<string> {
    const name = validName(rawName), now = new Date().toISOString();
    // Keep allocation and insertion atomic on this device, including rapid creates.
    return this.db.transaction('rw', ['trainingPlans'], async () => {
      const plans = await this.db.trainingPlans.where('realmId').equals(this.actorUserId).toArray();
      const position = plans.reduce((max, plan) => Math.max(max, plan.position), -1) + 1;
      // Built-in personal Dexie Cloud realm uses the authenticated user's cloud ID.
      return this.db.trainingPlans.add({
        realmId: this.actorUserId, owner: this.actorUserId, athleteUserId: this.actorUserId,
        coachUserId: null, clientUserId: null, name, position,
        status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
      });
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
    const assignedRealmId = realmId;
    return this.db.transaction('rw', ['trainingPlans'], async () => {
      const plans = await this.db.trainingPlans.where('realmId').equals(assignedRealmId).toArray();
      const position = plans.reduce((max, plan) => Math.max(max, plan.position), -1) + 1;
      const now = new Date().toISOString();
      return this.db.trainingPlans.add({
        realmId: assignedRealmId, owner: this.actorUserId, athleteUserId,
        coachUserId: this.actorUserId, clientUserId: athleteUserId,
        name, position, status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
      });
    });
  }
  async renameProgram(id: string, name: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans'], async () => {
      await this.currentParent(plan);
      await this.db.trainingPlans.update(id, { name: validName(name), updatedAt: new Date().toISOString() });
    });
  }
  async renamePhase(id: string, phaseId: string, name: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.currentParent(plan), phase = await this.db.programPhases.get(phaseId);
      if (!phase || phase.deletedAt || !isCloudPhaseRow(phase) || !belongs(phase, current)) throw new Error('Фаза не найдена');
      await this.db.programPhases.update(phaseId, { name: validName(name) });
    });
  }
  async duration(id: string, phaseId: string, weeks: number): Promise<void> {
    if (!isValidDurationWeeks(weeks)) throw new Error('Укажите положительное целое количество недель');
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.currentParent(plan), phase = await this.db.programPhases.get(phaseId);
      if (!phase || phase.deletedAt || !isCloudPhaseRow(phase) || !belongs(phase, current)) throw new Error('Фаза не найдена');
      await this.db.programPhases.update(phaseId, { durationWeeks: weeks });
    });
  }
  async createPhase(id: string, rawName?: string): Promise<string> {
    const plan = await this.writable(id);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const current = await this.currentParent(plan);
      const phases = await this.db.programPhases.where('trainingPlanId').equals(id).toArray();
      const used = new Set(phases.map((phase) => phase.name));
      let n = 1;
      while (used.has(`Фаза ${n}`)) n++;
      const name = rawName === undefined ? `Фаза ${n}` : validName(rawName);
      return this.db.programPhases.add({
        realmId: current.realmId, owner: this.actorUserId, trainingPlanId: id,
        name, status: 'draft', durationWeeks: DEFAULT_PHASE_WEEKS,
        position: phases.reduce((max, phase) => Math.max(max, phase.position), -1) + 1,
        plannedStartDate: null, plannedEndDate: null,
      });
    });
  }
  async publishPhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      await this.currentParent(plan);
      const phase = await this.db.programPhases.get(phaseId);
      if (!phase || phase.deletedAt || !belongs(phase, plan) || phase.status !== 'draft')
        throw new Error('Завершить заполнение можно только у черновика');
      await this.db.programPhases.update(phaseId, { status: 'pending' });
    });
  }
  async setPhaseStatus(id: string, phaseId: string, status: Exclude<PhaseStatus, 'active'>): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      const phase = await this.db.programPhases.get(phaseId);
      const current = await this.currentParent(plan);
      if (!phase || phase.deletedAt || !isCloudPhaseRow(phase) || !belongs(phase, current))
        throw new Error('Фаза не найдена');
      const wasActive = phase.status === 'active';
      await this.db.programPhases.update(phaseId, { status });
      if (wasActive && current.status === 'active' && status !== 'finished') {
        // Finishing one phase keeps the assigned program (and its history) visible.
        // Finishing the entire program is an explicit, separate operation.
        // pending has no program equivalent: the parent becomes a draft.
        const nextProgramStatus: CloudProgramStatus = status === 'pending' ? 'draft' : status;
        await this.db.trainingPlans.update(id, {
          status: nextProgramStatus, updatedAt: new Date().toISOString(),
          finishedAt: null,
        });
      }
    });
  }
  async setProgramStatus(id: string, status: InactiveStatus): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases'], async () => {
      await this.currentParent(plan);
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
    previousPhaseStatus?: Exclude<PhaseStatus, 'active'>;
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
      const current = await this.currentParent(plan);
      const target = await this.db.programPhases.get(phaseId);
      if (!target || target.deletedAt || !isCloudPhaseRow(target) || !belongs(target, current))
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

  /** Destructive/copy guards inspect persisted descendants, not the UI projection. */
  private async tree(plan: CloudTrainingPlanRow) {
    const phases = (await this.db.programPhases.where('trainingPlanId').equals(plan.id).toArray())
      .filter((phase) => phase.realmId === plan.realmId);
    if (phases.some((phase) => !isCloudPhaseRow(phase) || !belongs(phase, plan)))
      throw new Error('INVALID_CLOUD_PROGRAM_PHASE');
    const phaseIds = new Set(phases.map((phase) => phase.id));
    // Include deleted phases and all persisted descendants when deciding whether
    // source references must be retained for history or late offline changes.
    const days = (await this.db.programDays.where('realmId').equals(plan.realmId).toArray())
      .filter((day) => phaseIds.has(day.programPhaseId));
    return { phases: ordered(phases), days };
  }

  /** Recheck the parent inside the same transaction that writes its children. */
  private async currentParent(plan: CloudTrainingPlanRow): Promise<CloudTrainingPlanRow> {
    const current = await this.db.trainingPlans.get(plan.id);
    if (!current || current.deletedAt || !isCloudPlanRow(current) || !isExpectedPlanOwner(current)
      || current.realmId !== plan.realmId || current.coachUserId !== plan.coachUserId
      || current.clientUserId !== plan.clientUserId || athleteOf(current) !== athleteOf(plan))
      throw new Error('Программа изменилась. Повторите действие.');
    return current;
  }
  /** Server ACLs remain authoritative. Refuse new shared writes until the synced
   * global Coach policy includes the complete reviewed descendant allowlist. */
  private async dayAuthoringReady(plan: CloudTrainingPlanRow): Promise<void> {
    if (this.own(plan)) return;
    const roles: unknown[] = await this.db.table('roles').toArray();
    const ready = roles.some((role) => {
      if (!record(role) || role.realmId !== 'rlm-public' || role.name !== 'coach'
        || !record(role.permissions)) return false;
      const manage = role.permissions.manage;
      return Array.isArray(manage) && ['trainingPlans', 'programPhases',
        'programDays', 'programExercises', 'programSets'].every((table) => manage.includes(table));
    });
    if (!ready) throw new Error('Для работы с днями нужно обновить права тренера в Dexie Cloud и повторить синхронизацию.');
  }

  private async currentPhase(plan: CloudTrainingPlanRow, phaseId: string): Promise<CloudProgramPhaseRow> {
    const phase = await this.db.programPhases.get(phaseId);
    if (!phase || phase.deletedAt || !isCloudPhaseRow(phase) || !belongs(phase, plan))
      throw new Error('Фаза не найдена');
    return phase;
  }

  private async currentDay(plan: CloudTrainingPlanRow, dayId: string): Promise<CloudProgramDayRow> {
    const day = await this.db.programDays.get(dayId);
    if (!day || !belongsToPlan(day, plan) || day.status !== 'active') throw new Error('День не найден');
    await this.currentPhase(plan, day.programPhaseId);
    return day;
  }

  async createDay(id: string, phaseId: string, rawName: string, rawCategory = ''): Promise<string> {
    const name = validName(rawName), category = rawCategory.trim();
    if (category.length > 120) throw new Error('Категория должна содержать не более 120 символов');
    const plan = await this.writable(id);
    await this.dayAuthoringReady(plan);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays'], async () => {
      const current = await this.currentParent(plan);
      await this.currentPhase(current, phaseId);
      const days = await this.db.programDays.where('programPhaseId').equals(phaseId).toArray();
      return this.db.programDays.add({
        realmId: current.realmId, owner: this.actorUserId, programPhaseId: phaseId,
        name, category: category || null, comment: null, status: 'active',
        position: days.filter((day) => belongsToPlan(day, current))
          .reduce((max, day) => Math.max(max, day.position), -1) + 1,
      });
    });
  }

  async editDay(id: string, dayId: string, rawName: string, rawCategory: string): Promise<void> {
    const name = validName(rawName), category = rawCategory.trim();
    if (category.length > 120) throw new Error('Категория должна содержать не более 120 символов');
    await this.updateDay(id, dayId, { name, category: category || null });
  }

  async commentDay(id: string, dayId: string, rawComment: string): Promise<void> {
    const comment = rawComment.trim();
    if (comment.length > 4000) throw new Error('Комментарий должен содержать не более 4000 символов');
    await this.updateDay(id, dayId, { comment: comment || null });
  }

  private async updateDay(id: string, dayId: string,
    patch: Partial<Pick<CloudProgramDayRow, 'name' | 'category' | 'comment'>>): Promise<void> {
    const plan = await this.writable(id);
    await this.dayAuthoringReady(plan);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays'], async () => {
      const current = await this.currentParent(plan);
      await this.currentDay(current, dayId);
      await this.db.programDays.update(dayId, patch);
    });
  }

  async moveDay(id: string, dayId: string, direction: 'up' | 'down'): Promise<void> {
    const plan = await this.writable(id);
    await this.dayAuthoringReady(plan);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays'], async () => {
      const current = await this.currentParent(plan), day = await this.currentDay(current, dayId);
      const days = orderedPlanRows((await this.db.programDays.where('programPhaseId')
        .equals(day.programPhaseId).toArray()).filter((row) =>
        belongsToPlan(row, current) && row.status === 'active'));
      const from = days.findIndex((row) => row.id === dayId);
      const to = from + (direction === 'up' ? -1 : 1);
      if (to < 0 || to >= days.length) return;
      [days[from], days[to]] = [days[to], days[from]];
      // Normalize ties/gaps deterministically, but touch only positions that change.
      for (const [position, row] of days.entries()) {
        if (row.position !== position) await this.db.programDays.update(row.id, { position });
      }
    });
  }

  async deleteDay(id: string, dayId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.dayAuthoringReady(plan);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays'], async () => {
      const current = await this.currentParent(plan);
      await this.currentDay(current, dayId);
      // Tombstone keeps immutable session sources and offline-added descendants.
      await this.db.programDays.update(dayId, { status: 'deprecated' });
    });
  }

  private async copyDay(source: CloudProgramDayOutline, phaseId: string, position: number): Promise<string> {
    const { id: _dayId, ...day } = source.day;
    const nextDayId = await this.db.programDays.add({ ...day,
      owner: this.actorUserId, programPhaseId: phaseId, position, status: 'active' });
    for (const item of source.exercises) {
      const { id: _exerciseId, ...exercise } = item.exercise;
      const exerciseId = await this.db.programExercises.add({ ...exercise,
        owner: this.actorUserId, programDayId: nextDayId });
      for (const sourceSet of item.sets) {
        const { id: _setId, ...set } = sourceSet;
        await this.db.programSets.add({ ...set, owner: this.actorUserId, programExerciseId: exerciseId });
      }
    }
    return nextDayId;
  }

  private async copyPhase(source: CloudProgramPhaseRow, planId: string, position: number): Promise<string> {
    return this.db.programPhases.add({
      realmId: source.realmId, owner: this.actorUserId, trainingPlanId: planId,
      name: source.name, position, status: 'draft',
      durationWeeks: source.durationWeeks ?? DEFAULT_PHASE_WEEKS,
      plannedStartDate: source.plannedStartDate, plannedEndDate: source.plannedEndDate,
    });
  }

  async duplicateDay(id: string, dayId: string): Promise<string> {
    const plan = await this.writable(id);
    await this.dayAuthoringReady(plan);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
      const current = await this.currentParent(plan), day = await this.currentDay(current, dayId);
      const phase = await this.currentPhase(current, day.programPhaseId);
      const outline = await readProgramDays(this.db, current, [phase]);
      const source = outline.find((row) => row.day.id === dayId);
      if (!source) throw new Error('День не найден');
      const position = outline.reduce((max, row) => Math.max(max, row.day.position), -1) + 1;
      return this.copyDay(source, phase.id, position);
    });
  }

  async duplicatePhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    const initial = await this.tree(plan);
    if (initial.days.length) await this.dayAuthoringReady(plan);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
      const current = await this.currentParent(plan), tree = await this.tree(current);
      const source = await this.currentPhase(current, phaseId);
      const days = await readProgramDays(this.db, current, [source]);
      const copyId = await this.copyPhase(source, id,
        tree.phases.reduce((max, phase) => Math.max(max, phase.position), -1) + 1);
      for (const day of days) await this.copyDay(day, copyId, day.day.position);
    });
  }

  async duplicateProgram(id: string): Promise<string> {
    const original = await this.writable(id);
    const initial = await this.tree(original);
    if (initial.days.length) await this.dayAuthoringReady(original);
    return this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'programExercises', 'programSets'], async () => {
      const plan = await this.currentParent(original), tree = await this.tree(plan);
      const days = await readProgramDays(this.db, plan, tree.phases);
      const plans = await this.db.trainingPlans.where('realmId').equals(plan.realmId).toArray();
      const now = new Date().toISOString();
      const nextId = await this.db.trainingPlans.add({
        realmId: plan.realmId, owner: this.actorUserId, athleteUserId: athleteOf(plan) ?? undefined,
        coachUserId: plan.coachUserId, clientUserId: plan.clientUserId,
        name: validName(`${plan.name.slice(0, 111)} (копия)`),
        position: plans.reduce((max, row) => Math.max(max, row.position), -1) + 1,
        status: 'draft', startedAt: null, finishedAt: null, createdAt: now, updatedAt: now,
      });
      for (const phase of tree.phases.filter((row) => !row.deletedAt)) {
        const phaseId = await this.copyPhase(phase, nextId, phase.position);
        for (const day of days.filter((row) => row.day.programPhaseId === phase.id))
          await this.copyDay(day, phaseId, day.day.position);
      }
      return nextId;
    });
  }

  async deletePhase(id: string, phaseId: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays'], async () => {
      const current = await this.currentParent(plan), phase = await this.currentPhase(current, phaseId);
      if (phase.status === 'active') throw new Error('Сначала смените статус активной фазы');
      const tree = await this.tree(current);
      if (tree.days.some((day) => day.programPhaseId === phaseId)) {
        await this.db.programPhases.update(phaseId, { deletedAt: new Date().toISOString() });
      } else await this.db.programPhases.where('id').equals(phaseId).delete();
    });
  }

  async deleteProgram(id: string): Promise<void> {
    const plan = await this.writable(id);
    await this.db.transaction('rw', ['trainingPlans', 'programPhases', 'programDays',
      'workoutSessions'], async () => {
      const current = await this.currentParent(plan);
      if (current.status === 'active') throw new Error('Сначала смените статус активной программы');
      const tree = await this.tree(current);
      if (tree.days.length || await this.db.workoutSessions.where('trainingPlanId').equals(id).count()) {
        // Retain the entire source graph; a missing/deleted ancestor excludes all
        // descendants from PLAN, including records arriving on the next sync.
        await this.db.trainingPlans.update(id, { deletedAt: new Date().toISOString() });
      } else {
        await this.db.programPhases.where('trainingPlanId').equals(id).delete();
        await this.db.trainingPlans.where('id').equals(id).delete();
      }
    });
  }
}
