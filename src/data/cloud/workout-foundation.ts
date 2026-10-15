import { liveQuery } from 'dexie';
import { isWorkoutExerciseSnapshot } from './workout-foundation-types';
import { isApprovedAssignedPair } from './assigned-programs';
import { isExpectedPlanOwner, isExpectedPhaseOwner } from './program-ownership';
import type { MezfitCloudDatabase } from './database';
import type {
  CloudProgramOutline, CloudProgramDayRow, CloudProgramExerciseRow,
  CloudProgramPhaseRow, CloudProgramSetRow,
} from './workout-foundation-types';

function ordered<T extends { id: string; position: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/**
 * Read-only preparatory boundary for the relationship-scoped workout domain.
 * No UI consumes this repository yet and it intentionally exposes no writes.
 * Real writes require proven server ACLs and a separate lifecycle implementation.
 */
export class WorkoutFoundationRepository {
  constructor(
    private readonly db: MezfitCloudDatabase,
    private readonly actorUserId: string,
  ) {}

  async getProgramOutline(programId: string): Promise<CloudProgramOutline | null> {
    if (!programId || !/^tg:[1-9]\d*$/.test(this.actorUserId)) return null;
    const plan = await this.db.trainingPlans.get(programId);
    if (!plan || !isExpectedPlanOwner(plan)) return null;
    const personal = plan.realmId === this.actorUserId
      && plan.athleteUserId === this.actorUserId
      && plan.coachUserId === null && plan.clientUserId === null;
    if (!personal && (plan.coachUserId !== this.actorUserId
      && plan.clientUserId !== this.actorUserId)) return null;
    if (!personal) {
      if (!plan.coachUserId || !plan.clientUserId) return null;
      const [realm, members] = await Promise.all([
        this.db.realms.get(plan.realmId),
        this.db.members.where('realmId').equals(plan.realmId).toArray(),
      ]);
      if (!await isApprovedAssignedPair(realm, members, plan.coachUserId, plan.clientUserId)) {
        return null;
      }
    }

    // One realm-scoped query per table: all joins are checked again locally so
    // dangling references and mismatched child realm IDs never enter the UI.
    const [phaseRows, dayRows, exerciseRows, setRows] = await Promise.all([
      this.db.programPhases.where('realmId').equals(plan.realmId).toArray(),
      this.db.programDays.where('realmId').equals(plan.realmId).toArray(),
      this.db.programExercises.where('realmId').equals(plan.realmId).toArray(),
      this.db.programSets.where('realmId').equals(plan.realmId).toArray(),
    ]);
    const phases = ordered(phaseRows.filter((p) =>
      p.trainingPlanId === plan.id && p.realmId === plan.realmId && isExpectedPhaseOwner(p, plan)));
    const phaseIds = new Set(phases.map((p) => p.id));
    const days = ordered(dayRows.filter((d) =>
      d.realmId === plan.realmId && d.owner === null && phaseIds.has(d.programPhaseId)));
    const dayIds = new Set(days.map((d) => d.id));
    const exercises = ordered(exerciseRows.filter((e) =>
      e.realmId === plan.realmId && e.owner === null && dayIds.has(e.programDayId)));
    // Reject a malformed synced snapshot explicitly; silently dropping an exercise
    // would hide assigned sets and could make the workout appear complete.
    for (const { exercise } of exercises) {
      if (!isWorkoutExerciseSnapshot(exercise)) {
        throw new Error('INVALID_CLOUD_WORKOUT_EXERCISE_SNAPSHOT');
      }
    }
    const exerciseIds = new Set(exercises.map((e) => e.id));
    const sets = ordered(setRows.filter((s) =>
      s.realmId === plan.realmId && s.owner === null && exerciseIds.has(s.programExerciseId)));

    const setsByExercise = new Map<string, CloudProgramSetRow[]>();
    for (const set of sets) {
      const group = setsByExercise.get(set.programExerciseId) ?? [];
      group.push(set);
      setsByExercise.set(set.programExerciseId, group);
    }
    const exercisesByDay = new Map<string, CloudProgramExerciseRow[]>();
    for (const exercise of exercises) {
      const group = exercisesByDay.get(exercise.programDayId) ?? [];
      group.push(exercise);
      exercisesByDay.set(exercise.programDayId, group);
    }
    const daysByPhase = new Map<string, CloudProgramDayRow[]>();
    for (const day of days) {
      const group = daysByPhase.get(day.programPhaseId) ?? [];
      group.push(day);
      daysByPhase.set(day.programPhaseId, group);
    }

    return {
      planId: plan.id,
      realmId: plan.realmId,
      phases: phases.map((phase: CloudProgramPhaseRow) => ({
        phase,
        days: (daysByPhase.get(phase.id) ?? []).map((day: CloudProgramDayRow) => ({
          day,
          exercises: (exercisesByDay.get(day.id) ?? []).map((exercise: CloudProgramExerciseRow) => ({
            exercise,
            sets: setsByExercise.get(exercise.id) ?? [],
          })),
        })),
      })),
    };
  }

  observeProgramOutline(
    programId: string,
    onChange: (outline: CloudProgramOutline | null) => void,
    onError: (error: unknown) => void,
  ): { unsubscribe(): void } {
    return liveQuery(() => this.getProgramOutline(programId)).subscribe({
      next: onChange,
      error: onError,
    });
  }
}
