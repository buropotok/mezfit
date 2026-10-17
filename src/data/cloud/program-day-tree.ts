import type { CloudTrainingPlanRow, MezfitCloudDatabase } from './database';
import { planAuthorUserId } from './program-ownership';
import { isProgramExerciseSnapshot, type CloudPlanChildRow, type CloudProgramDayOutline,
  type CloudProgramPhaseRow } from './workout-foundation-types';

export function orderedPlanRows<T extends { id: string; position: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function belongsToPlan(row: CloudPlanChildRow, plan: CloudTrainingPlanRow): boolean {
  return row.realmId === plan.realmId
    && (row.owner === null || row.owner === planAuthorUserId(plan));
}

function validChild(row: CloudPlanChildRow & { position: number }): boolean {
  return typeof row.id === 'string' && row.id.length > 0
    && Number.isSafeInteger(row.position) && row.position >= 0;
}

/** One authorized realm query per table. Ancestor checks also hide late synced
 * children of deleted parents; no history/session tables are rewritten. */
export async function readProgramDays(
  db: MezfitCloudDatabase, plan: CloudTrainingPlanRow, phases: readonly CloudProgramPhaseRow[],
): Promise<CloudProgramDayOutline[]> {
  const phaseIds = new Set(phases.filter((phase) => !phase.deletedAt).map((phase) => phase.id));
  const candidates = await db.programDays.where('realmId').equals(plan.realmId).toArray();
  const days = orderedPlanRows(candidates.filter((day) =>
    phaseIds.has(day.programPhaseId) && belongsToPlan(day, plan) && day.status === 'active'));
  for (const day of days) {
    if (!validChild(day) || typeof day.name !== 'string' || !day.name.trim()
      || (day.category != null && typeof day.category !== 'string')
      || (day.comment != null && typeof day.comment !== 'string')) throw new Error('INVALID_CLOUD_PROGRAM_DAY');
  }
  if (!days.length) return [];
  const [exerciseRows, setRows] = await Promise.all([
    db.programExercises.where('realmId').equals(plan.realmId).toArray(),
    db.programSets.where('realmId').equals(plan.realmId).toArray(),
  ]);
  const dayIds = new Set(days.map((day) => day.id));
  const exercises = orderedPlanRows(exerciseRows.filter((row) =>
    dayIds.has(row.programDayId) && belongsToPlan(row, plan) && row.status === 'active'));
  for (const row of exercises) {
    if (!validChild(row) || !isProgramExerciseSnapshot(row.exercise)
      || (row.notes != null && typeof row.notes !== 'string'))
      throw new Error('INVALID_CLOUD_WORKOUT_EXERCISE_SNAPSHOT');
  }
  const exerciseIds = new Set(exercises.map((row) => row.id));
  const sets = orderedPlanRows(setRows.filter((row) =>
    exerciseIds.has(row.programExerciseId) && belongsToPlan(row, plan) && row.status === 'active'));
  for (const row of sets) {
    if (!validChild(row)
      || [row.plannedReps, row.plannedWeightKg, row.plannedDurationSeconds, row.plannedDistanceMeters]
        .some((value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
      || (row.plannedReps !== null && !Number.isSafeInteger(row.plannedReps))
      || (row.comment != null && typeof row.comment !== 'string')
      || (row.setLabel != null && !['warmup', 'easy', 'normal', 'hard', 'drop'].includes(row.setLabel))
      || [row.materialLinks, row.chatLinks].some((links) => links !== undefined
        && (!Array.isArray(links) || !links.every((link) => typeof link === 'string'))))
      throw new Error('INVALID_CLOUD_PROGRAM_SET');
  }
  return days.map((day) => ({
    day, exercises: exercises.filter((row) => row.programDayId === day.id).map((exercise) => ({
      exercise, sets: sets.filter((row) => row.programExerciseId === exercise.id),
    })),
  }));
}
