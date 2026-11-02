import type { MezfitCloudDatabase } from './database';
import type { CloudProgramDayOutline, CloudProgramPhaseRow } from './workout-foundation-types';
import { AdHocWorkoutRepository } from './adhoc-workouts';
import { isAdHocExerciseRow, isAdHocSetRow } from './adhoc-workout-types';
import { bookingsShareParticipant } from './workout-slot-validation';
import { parseLocalDate } from '../../ui/date-picker/datePickerDate';
import type { LocalDate } from '../../ui/date-picker/DatePicker';
import type { CloudTrainingPlanRow } from './database';
import { isApprovedAssignedPair } from './assigned-programs';
import { ProgramManagementRepository } from './program-management';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { draftFromProgramDay, type LocalWorkoutOccurrenceDraft, type WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { nextAvailableSlot } from '../../schedule/available-slot';

/** Copies retain immutable prescription, but never reuse child occurrence identities. */
function freshPlan(plan: WorkoutOccurrencePlan): WorkoutOccurrencePlan {
  return { ...structuredClone(plan), exercises: plan.exercises.map(exercise => ({
    ...structuredClone(exercise), id: crypto.randomUUID(),
    sets: exercise.sets.map(set => ({ ...structuredClone(set), id: crypto.randomUUID() })),
  })) };
}


const AUTHORING_TABLES = ['trainingPlans', 'programPhases', 'programDays', 'programExercises',
  'programSets', 'workoutOccurrences', 'localProgramSync', 'localWorkoutSync', 'realms', 'members', 'roles'];

/** Shared application service for all planning entry points. Local transactions only. */
export class WorkoutPlanningRepository {
  readonly programs: ProgramManagementRepository;
  readonly drafts: WorkoutOccurrenceDraftRepository;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    this.programs = new ProgramManagementRepository(db, actorUserId);
    this.drafts = new WorkoutOccurrenceDraftRepository(db, actorUserId);
  }

  private authoringTables(): string[] {
    return [...AUTHORING_TABLES, ...(this.db.tables.some(table => table.name === 'adHocSessions') ? ['adHocSessions'] : [])];
  }

  private async scope(athleteUserId: string) {
    if (athleteUserId === this.actorUserId)
      return { realmId: this.actorUserId, athleteUserId, coachUserId: null, clientUserId: null };
    const realms = await this.db.realms.toArray();
    const members = await this.db.members.toArray();
    for (const realm of realms) {
      if (await isApprovedAssignedPair(realm, members.filter(row => row.realmId === realm.realmId),
        this.actorUserId, athleteUserId))
        return { realmId: realm.realmId, athleteUserId, coachUserId: this.actorUserId, clientUserId: athleteUserId };
    }
    throw new Error('Нет доступа к тренировкам этого клиента');
  }

  async suggestSlot(athleteUserId: string, coachUserId: string | null,
    format: 'independent' | 'coached'): Promise<string> {
    const scheduling = new WorkoutSchedulingRepository(this.db, this.actorUserId);
    const entries: Pick<LocalWorkoutOccurrenceDraft,
      'athleteUserId' | 'coachUserId' | 'format' | 'startsAtUtc' | 'durationMinutes'>[]
      = await scheduling.listCalendar(athleteUserId, true);
    entries.push(...await this.drafts.list());
    if (format === 'coached' && coachUserId) entries.push(...await scheduling.listCalendar(coachUserId, true));
    const relevant = entries.filter(row => row.athleteUserId === athleteUserId
      || (row.format === 'coached' && row.coachUserId === athleteUserId)
      || (format === 'coached' && (row.athleteUserId === coachUserId
        || (row.format === 'coached' && row.coachUserId === coachUserId))));
    const slot = nextAvailableSlot(relevant, new Date(), 60);
    if (!slot) throw new Error('Не удалось найти свободное время. Выберите другой период в расписании');
    return slot.toISOString();
  }

  /** Creates a new published calendar booking on the selected *local* day. */
  private async copyPlan(source: Pick<LocalWorkoutOccurrenceDraft,
    'realmId' | 'athleteUserId' | 'coachUserId' | 'clientUserId' | 'format' | 'durationMinutes' | 'plan' | 'trainingPlanId' | 'programDayId'>,
    date: LocalDate): Promise<string> {
    const selected = parseLocalDate(date);
    if (!selected) throw new Error('Некорректная дата тренировки');
    const scheduling = new WorkoutSchedulingRepository(this.db, this.actorUserId);
    const [athlete, coach] = await Promise.all([
      scheduling.listCalendar(source.athleteUserId, true),
      source.format === 'coached' && source.coachUserId
        ? scheduling.listCalendar(source.coachUserId, true) : Promise.resolve([]),
    ]);
    const proposed = new Date(selected.year, selected.month - 1, selected.day, 8, 0, 0, 0);
    const relevant = [...new Map([...athlete, ...coach]
      .filter(row => bookingsShareParticipant(source, row)).map(row => [row.id, row])).values()];
    const slot = nextAvailableSlot(relevant, proposed, source.durationMinutes);
    if (!slot || slot.getFullYear() !== selected.year || slot.getMonth() !== selected.month - 1
      || slot.getDate() !== selected.day)
      throw new Error('На выбранную дату нет свободного слота для этой тренировки');
    const timestamp = new Date().toISOString();
    const plan = freshPlan(source.plan);
    const draft: LocalWorkoutOccurrenceDraft = {
      id: 'draft:' + crypto.randomUUID(), actorUserId: this.actorUserId,
      realmId: source.realmId, athleteUserId: source.athleteUserId,
      coachUserId: source.coachUserId, clientUserId: source.clientUserId,
      format: source.format, startsAtUtc: slot.toISOString(), durationMinutes: source.durationMinutes,
      ...(source.trainingPlanId && source.programDayId
        ? { trainingPlanId: source.trainingPlanId, programDayId: source.programDayId } : {}),
      plan, originalPlan: structuredClone(plan), createdAt: timestamp, updatedAt: timestamp,
    };
    // One local transaction: no intermediate unpublished copy and no cloud/HTTP wait.
    return this.drafts.create(draft, { published: true });
  }

  /** The locally authorized occurrence snapshot is the source of truth, even after Start. */
  async copyOccurrence(occurrenceId: string, date: LocalDate): Promise<string> {
    const source = await this.drafts.get('draft:' + occurrenceId);
    if (!source) throw new Error('Исходная тренировка недоступна');
    return this.copyPlan(source, date);
  }

  /** FACT is not a prescription. A planned session uses its frozen occurrencePlan. */
  async copySession(sessionId: string, date: LocalDate): Promise<string> {
    const session = await new AdHocWorkoutRepository(this.db, this.actorUserId).getRow(sessionId);
    if (!session) throw new Error('Исходная сессия недоступна');
    const linked = session.occurrenceId ? await this.db.workoutOccurrences.get(session.occurrenceId) : null;
    const occurrence = linked && linked.realmId === session.realmId
      && linked.athleteUserId === session.athleteUserId && linked.coachUserId === session.coachUserId
      && linked.clientUserId === session.clientUserId && linked.workoutSessionId === session.id
      ? linked : null;
    if (session.occurrenceId && (!occurrence || !session.occurrencePlan))
      throw new Error('План запущенной тренировки недоступен');
    let plan: WorkoutOccurrencePlan;
    if (session.occurrencePlan) {
      plan = structuredClone(session.occurrencePlan);
    } else {
      const [exercises, sets] = await Promise.all([
        this.db.adHocExercises.where('sessionId').equals(session.id).toArray(),
        this.db.adHocSets.where('sessionId').equals(session.id).toArray(),
      ]);
      const activeExercises = exercises.filter(row => isAdHocExerciseRow(row) && !row.deletedAt
        && row.realmId === session.realmId && row.owner === session.realmId)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
      plan = { name: session.name, comment: null, exercises: activeExercises.map((exercise, position) => ({
        id: exercise.id, sourceProgramExerciseId: null, position,
        exercise: structuredClone(exercise.exercise), notes: exercise.notes,
        sets: sets.filter(set => isAdHocSetRow(set) && !set.deletedAt && set.exerciseId === exercise.id
          && set.realmId === session.realmId && set.owner === session.realmId)
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((set, setPosition) => ({
            id: set.id, sourceProgramSetId: null, position: setPosition,
            setType: set.setType, setLabel: set.setLabel, comment: null,
            materialLinks: [], chatLinks: [], plannedReps: null, plannedWeightKg: null,
            plannedDurationSeconds: null, plannedDistanceMeters: null,
          })),
      })) };
    }
    return this.copyPlan({
      realmId: session.realmId, athleteUserId: session.athleteUserId,
      coachUserId: session.coachUserId, clientUserId: session.clientUserId,
      format: occurrence?.format ?? (session.coachUserId ? 'coached' : 'independent'),
      durationMinutes: occurrence?.durationMinutes ?? 60, plan,
      ...(session.programId && session.dayId
        ? { trainingPlanId: session.programId, programDayId: session.dayId } : {}),
    }, date);
  }

  async createFromProgramDay(program: CloudTrainingPlanRow, day: CloudProgramDayOutline,
    format: 'independent' | 'coached', phaseStatus: CloudProgramPhaseRow['status']): Promise<string> {
    const startsAtUtc = await this.suggestSlot(program.clientUserId ?? this.actorUserId, program.coachUserId, format);
    return this.drafts.create(draftFromProgramDay(this.actorUserId, program, day, format, startsAtUtc, 60, phaseStatus));
  }

  async createBlank(athleteUserId: string, format: 'independent' | 'coached'):
    Promise<{ id: string; createdProgram: boolean }> {
    const scope = await this.scope(athleteUserId);
    if (format === 'coached' && !scope.coachUserId) throw new Error('Для своей тренировки выберите самостоятельный формат');
    const startsAtUtc = await this.suggestSlot(athleteUserId, scope.coachUserId, format);
    return this.db.transaction('rw', this.authoringTables(), async () => {
      // The existence check and graph creation share one transaction, including rapid creates.
      const programs = await this.programs.listForScheduling(athleteUserId);
      let trainingPlanId: string | undefined;
      let programDayId: string | undefined;
      if (!programs.length) {
        trainingPlanId = athleteUserId === this.actorUserId
          ? await this.programs.createPersonal('Программа тренировок')
          : await this.programs.createAssigned(athleteUserId, 'Программа тренировок');
        const details = await this.programs.details(trainingPlanId);
        const phase = details?.phases[0];
        if (!phase) throw new Error('Не удалось создать фазу программы');
        programDayId = await this.programs.createDay(trainingPlanId, phase.id, 'Тренировка');
      }
      const plan: WorkoutOccurrencePlan = { name: 'Тренировка', comment: null, exercises: [] };
      const now = new Date().toISOString();
      const draft: LocalWorkoutOccurrenceDraft = {
        ...scope, id: 'draft:' + crypto.randomUUID(), actorUserId: this.actorUserId,
        trainingPlanId, programDayId, autoCreatedProgram: Boolean(trainingPlanId),
        plan, originalPlan: structuredClone(plan), startsAtUtc, durationMinutes: 60, format,
        createdAt: now, updatedAt: now,
      };
      return { id: await this.drafts.create(draft), createdProgram: Boolean(trainingPlanId) };
    });
  }

  async publish(id: string): Promise<string> {
    await this.drafts.flushEdits(id);
    const draft = await this.drafts.get(id);
    if (!draft) throw new Error('Тренировка не найдена');
    if (!draft.autoCreatedProgram || draft.previouslyPublished) return this.drafts.save(id);
    return this.db.transaction('rw', this.authoringTables(), async () => {
      const current = await this.drafts.get(id);
      if (!current?.trainingPlanId || !current.programDayId) throw new Error('Программа тренировки не найдена');
      if (!current.previouslyPublished) {
        const details = await this.programs.details(current.trainingPlanId);
        const day = details?.days?.find(row => row.day.id === current.programDayId);
        if (!day) throw new Error('Созданный день удалён. Добавьте тренировку в другую программу.');
        await this.programs.saveWorkoutAsDay(current.athleteUserId, {
          programId: current.trainingPlanId, phaseId: day.day.programPhaseId, dayId: current.programDayId,
          name: current.plan.name, expected: current.originalPlan,
        }, current.plan);
      }
      return this.drafts.save(id);
    });
  }

  async addToProgram(id: string, target: {
    programId: string; phaseId: string; dayId?: string; name: string; expected?: WorkoutOccurrencePlan;
  }): Promise<string> {
    await this.drafts.flushEdits(id);
    // Read current accepted content, rather than the editor's potentially stale projection.
    return this.db.transaction('rw', this.authoringTables(), async () => {
      const occurrence = await this.drafts.get(id);
      if (!occurrence) throw new Error('Тренировка недоступна');
      return this.programs.saveWorkoutAsDay(occurrence.athleteUserId, target, occurrence.plan);
    });
  }
}
