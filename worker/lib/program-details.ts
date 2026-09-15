import type { ExerciseDefinitionRow } from './exercises';
import { getProgramByIdForCoach, type ProgramListItem, type ProgramOwner } from './programs';

export type ProgramPhaseStatus = 'pending' | 'active' | 'finished';

export interface ProgramPhaseExerciseDetails {
  programExerciseId: number;
  dayId: number;
  dayName: string;
  dayPosition: number;
  position: number;
  setCount: number;
  completed: boolean;
  notes: string | null;
  exercise: ExerciseDefinitionRow;
}

export interface ProgramPhaseDetails {
  id: number;
  name: string;
  position: number;
  status: ProgramPhaseStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  completedExerciseCount: number;
  exerciseCount: number;
  progressPercent: number;
  exercises: ProgramPhaseExerciseDetails[];
}

export interface CoachProgramDetails {
  program: ProgramListItem;
  owner: ProgramOwner;
  ownerType: 'self' | 'client';
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  completedExerciseCount: number;
  exerciseCount: number;
  progressPercent: number;
  phases: ProgramPhaseDetails[];
}

interface OwnerRow {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
}

interface PhaseExerciseRow {
  phase_id: number;
  phase_name: string;
  phase_position: number;
  phase_status: ProgramPhaseStatus;
  phase_planned_start_date: string | null;
  phase_planned_end_date: string | null;
  phase_started_at: string | null;
  phase_finished_at: string | null;
  day_id: number | null;
  day_name: string | null;
  day_position: number | null;
  program_exercise_id: number | null;
  exercise_position: number | null;
  exercise_notes: string | null;
  exercise_id: number | null;
  exercise_scope: ExerciseDefinitionRow['scope'] | null;
  exercise_name: string | null;
  exercise_description: string | null;
  exercise_tracking_type: ExerciseDefinitionRow['tracking_type'] | null;
  exercise_category_code: ExerciseDefinitionRow['category_code'];
  exercise_equipment_code: ExerciseDefinitionRow['equipment_code'];
  exercise_reference_source: string | null;
  exercise_reference_key: string | null;
  exercise_reference_media_url: string | null;
  exercise_is_favourite: number;
  exercise_can_edit: number;
  set_count: number;
  completed: number;
}

function progressPercent(completed: number, total: number, finished: boolean): number {
  if (finished) return 100;
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

function ownerView(row: OwnerRow): ProgramOwner {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    photoUrl: row.photo_url,
  };
}

function exerciseView(row: PhaseExerciseRow): ExerciseDefinitionRow | null {
  if (
    row.exercise_id === null
    || row.exercise_scope === null
    || row.exercise_name === null
    || row.exercise_tracking_type === null
  ) return null;

  return {
    id: row.exercise_id,
    scope: row.exercise_scope,
    name: row.exercise_name,
    description: row.exercise_description,
    tracking_type: row.exercise_tracking_type,
    category_code: row.exercise_category_code,
    equipment_code: row.exercise_equipment_code,
    reference_source: row.exercise_reference_source,
    reference_key: row.exercise_reference_key,
    reference_media_url: row.exercise_reference_media_url,
    is_favourite: row.exercise_is_favourite === 1,
    can_edit: row.exercise_can_edit === 1,
  };
}

export async function getCoachProgramDetails(
  db: D1Database,
  programId: number,
  coachUserId: number,
): Promise<CoachProgramDetails | null> {
  const program = await getProgramByIdForCoach(db, programId, coachUserId);
  if (!program) return null;

  const [owner, phaseResult] = await Promise.all([
    db.prepare(`
      SELECT id, first_name, last_name, username, photo_url
      FROM app_user
      WHERE id = ?
    `).bind(program.userId).first<OwnerRow>(),
    db.prepare(`
      SELECT
        phase.id AS phase_id,
        phase.name AS phase_name,
        phase.position AS phase_position,
        phase.status AS phase_status,
        phase.planned_start_date AS phase_planned_start_date,
        phase.planned_end_date AS phase_planned_end_date,
        phase.started_at AS phase_started_at,
        phase.finished_at AS phase_finished_at,
        day.id AS day_id,
        day.name AS day_name,
        day.position AS day_position,
        program_exercise.id AS program_exercise_id,
        program_exercise.position AS exercise_position,
        program_exercise.notes AS exercise_notes,
        exercise.id AS exercise_id,
        exercise.scope AS exercise_scope,
        CASE WHEN exercise_override.exercise_definition_id IS NULL THEN exercise.name ELSE exercise_override.name END AS exercise_name,
        CASE WHEN exercise_override.exercise_definition_id IS NULL THEN exercise.description ELSE exercise_override.description END AS exercise_description,
        CASE WHEN exercise_override.exercise_definition_id IS NULL THEN exercise.tracking_type ELSE exercise_override.tracking_type END AS exercise_tracking_type,
        CASE WHEN exercise_override.exercise_definition_id IS NULL THEN exercise.category_code ELSE exercise_override.category_code END AS exercise_category_code,
        CASE WHEN exercise_override.exercise_definition_id IS NULL THEN exercise.equipment_code ELSE exercise_override.equipment_code END AS exercise_equipment_code,
        exercise.reference_source AS exercise_reference_source,
        exercise.reference_key AS exercise_reference_key,
        exercise.reference_media_url AS exercise_reference_media_url,
        CASE WHEN favourite.exercise_definition_id IS NULL THEN 0 ELSE 1 END AS exercise_is_favourite,
        CASE
          WHEN exercise.scope = 'global' THEN 1
          WHEN exercise.scope = 'coach' AND exercise.owner_coach_user_id = ? THEN 1
          ELSE 0
        END AS exercise_can_edit,
        CASE WHEN program_exercise.id IS NULL THEN 0 ELSE (
          SELECT COUNT(*)
          FROM program_set
          WHERE program_exercise_id = program_exercise.id AND status = 'active'
        ) END AS set_count,
        CASE WHEN program_exercise.id IS NULL THEN 0 ELSE EXISTS (
          SELECT 1
          FROM session_exercise
          WHERE source_program_exercise_id = program_exercise.id AND status = 'completed'
        ) END AS completed
      FROM program_phase phase
      LEFT JOIN program_day day
        ON day.program_phase_id = phase.id AND day.status = 'active'
      LEFT JOIN program_exercise
        ON program_exercise.program_day_id = day.id AND program_exercise.status = 'active'
      LEFT JOIN exercise_definition exercise
        ON exercise.id = program_exercise.exercise_definition_id
      LEFT JOIN exercise_definition_override exercise_override
        ON exercise_override.exercise_definition_id = exercise.id AND exercise_override.coach_user_id = ?
      LEFT JOIN coach_exercise_favourite favourite
        ON favourite.exercise_definition_id = exercise.id AND favourite.coach_user_id = ?
      WHERE phase.training_plan_id = ?
      ORDER BY phase.position, phase.id, day.position, day.id, program_exercise.position, program_exercise.id
    `).bind(coachUserId, coachUserId, coachUserId, programId).all<PhaseExerciseRow>(),
  ]);
  if (!owner) return null;

  const phaseMap = new Map<number, ProgramPhaseDetails>();
  for (const row of phaseResult.results) {
    let phase = phaseMap.get(row.phase_id);
    if (!phase) {
      phase = {
        id: row.phase_id,
        name: row.phase_name,
        position: row.phase_position,
        status: row.phase_status,
        plannedStartDate: row.phase_planned_start_date,
        plannedEndDate: row.phase_planned_end_date,
        startedAt: row.phase_started_at,
        finishedAt: row.phase_finished_at,
        completedExerciseCount: 0,
        exerciseCount: 0,
        progressPercent: 0,
        exercises: [],
      };
      phaseMap.set(row.phase_id, phase);
    }

    const exercise = exerciseView(row);
    if (
      !exercise
      || row.program_exercise_id === null
      || row.day_id === null
      || row.day_name === null
      || row.day_position === null
      || row.exercise_position === null
    ) continue;

    phase.exercises.push({
      programExerciseId: row.program_exercise_id,
      dayId: row.day_id,
      dayName: row.day_name,
      dayPosition: row.day_position,
      position: row.exercise_position,
      setCount: row.set_count,
      completed: row.completed === 1,
      notes: row.exercise_notes,
      exercise,
    });
  }

  const phases = [...phaseMap.values()];
  let completedExerciseCount = 0;
  let exerciseCount = 0;
  for (const phase of phases) {
    phase.exerciseCount = phase.exercises.length;
    const actualCompleted = phase.exercises.filter((exercise) => exercise.completed).length;
    phase.completedExerciseCount = phase.status === 'finished' ? phase.exerciseCount : actualCompleted;
    phase.progressPercent = progressPercent(phase.completedExerciseCount, phase.exerciseCount, phase.status === 'finished');
    completedExerciseCount += phase.completedExerciseCount;
    exerciseCount += phase.exerciseCount;
  }

  const plannedStarts = phases.map((phase) => phase.plannedStartDate).filter((value): value is string => Boolean(value));
  const plannedEnds = phases.map((phase) => phase.plannedEndDate).filter((value): value is string => Boolean(value));

  return {
    program,
    owner: ownerView(owner),
    ownerType: program.userId === coachUserId ? 'self' : 'client',
    plannedStartDate: plannedStarts.length > 0 ? plannedStarts.reduce((earliest, value) => value < earliest ? value : earliest) : null,
    plannedEndDate: plannedEnds.length > 0 ? plannedEnds.reduce((latest, value) => value > latest ? value : latest) : null,
    completedExerciseCount,
    exerciseCount,
    progressPercent: progressPercent(completedExerciseCount, exerciseCount, program.status === 'finished'),
    phases,
  };
}
