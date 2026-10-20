import type { MezfitCloudDatabase } from './database';
import type { CloudProgramDayOutline, CloudProgramPhaseRow } from './workout-foundation-types';
import type { CloudTrainingPlanRow } from './database';
import { isApprovedAssignedPair } from './assigned-programs';
import { ProgramManagementRepository } from './program-management';
import { WorkoutOccurrenceDraftRepository } from './workout-occurrence-drafts';
import { draftFromProgramDay, type LocalWorkoutOccurrenceDraft, type WorkoutOccurrencePlan } from './workout-occurrence-plan';
import { WorkoutSchedulingRepository } from './workout-scheduling';
import { nextAvailableSlot } from '../../schedule/available-slot';

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
    return this.db.transaction('rw', AUTHORING_TABLES, async () => {
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
    return this.db.transaction('rw', AUTHORING_TABLES, async () => {
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
    return this.db.transaction('rw', AUTHORING_TABLES, async () => {
      const rows = await new WorkoutSchedulingRepository(this.db, this.actorUserId).listWorkspace();
      const occurrence = rows.find(row => 'draft:' + row.id === id);
      if (!occurrence) throw new Error('Тренировка недоступна');
      return this.programs.saveWorkoutAsDay(occurrence.athleteUserId, target, occurrence.plan);
    });
  }
}
