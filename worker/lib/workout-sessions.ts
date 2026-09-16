import type {
  ExerciseCategoryCode,
  ExerciseEquipmentCode,
  ExerciseScope,
  TrackingType,
} from './exercises';

export type WorkoutSessionStatus = 'draft' | 'active' | 'completed';
export type SessionExerciseStatus = 'planned' | 'active' | 'completed' | 'skipped' | 'inactive';
export type SessionSetStatus = 'pending' | 'completed' | 'skipped';
export type WorkoutStartInput = { type: 'own' } | { type: 'program'; programDayId: number };
export type WorkoutSetLabel = 'warmup' | 'easy' | 'normal' | 'hard' | 'drop';
export type ResistanceBandCode = 'yellow' | 'red' | 'green' | 'blue' | 'purple' | 'black';

export interface WorkoutMetrics {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface WorkoutSetFactInput {
  metrics: WorkoutMetrics;
  setLabel: WorkoutSetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
}

export interface WorkoutProgramSummary { id: number; name: string }
export interface WorkoutPhaseSummary { id: number; name: string }
export interface WorkoutDaySummary { id: number; name: string; position: number }
export interface WorkoutDayOption extends WorkoutDaySummary { completed: boolean }
export interface SuggestedWorkoutDay extends WorkoutDaySummary {
  resolution: 'scheduled_today' | 'next_incomplete';
}

export interface DraftWorkoutSession {
  sessionId: number;
  status: 'draft';
  program: WorkoutProgramSummary | null;
  phase: WorkoutPhaseSummary | null;
  suggestedDay: SuggestedWorkoutDay | null;
  availableDays: WorkoutDayOption[];
}

export interface WorkoutExerciseDefinition {
  id: number;
  scope: ExerciseScope;
  name: string;
  description: string | null;
  tracking_type: TrackingType;
  category_code: ExerciseCategoryCode | null;
  equipment_code: ExerciseEquipmentCode | null;
  reference_source: string | null;
  reference_key: string | null;
  reference_media_url: string | null;
  is_favourite: boolean;
  can_edit: boolean;
}

export interface PreviousWorkoutSet {
  workoutDate: string;
  metrics: WorkoutMetrics;
}

export interface ExistingWorkoutSetFact {
  metrics: WorkoutMetrics;
  setLabel: WorkoutSetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands: ResistanceBandCode[];
}

export interface WorkoutSessionSetData {
  sessionSetId: number;
  sourceProgramSetId: number | null;
  position: number;
  status: SessionSetStatus;
  plan: WorkoutMetrics | null;
  previous: PreviousWorkoutSet | null;
  fact: ExistingWorkoutSetFact | null;
}

export interface WorkoutSessionExerciseData {
  sessionExerciseId: number;
  workoutSessionId: number;
  sourceProgramExerciseId: number | null;
  position: number;
  status: SessionExerciseStatus;
  notes: string | null;
  exercise: WorkoutExerciseDefinition;
  sets: WorkoutSessionSetData[];
}

export interface ActiveWorkoutSession {
  sessionId: number;
  status: 'active' | 'completed';
  workoutDate: string;
  program: WorkoutProgramSummary | null;
  phase: WorkoutPhaseSummary | null;
  day: WorkoutDaySummary | null;
  exercises: WorkoutSessionExerciseData[];
}

export type WorkoutInitializeResult = DraftWorkoutSession | ActiveWorkoutSession;

export type WorkoutProgramResolution =
  | { kind: 'none' }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; programs: WorkoutProgramSummary[] }
  | {
      kind: 'selected';
      program: WorkoutProgramSummary;
      phase: WorkoutPhaseSummary;
      coachUserId: number;
    };

interface ActiveProgramRow {
  program_id: number;
  program_name: string;
  phase_id: number;
  phase_name: string;
  coach_user_id: number;
}

interface WorkoutSessionRow {
  id: number;
  user_id: number;
  source_program_phase_id: number | null;
  source_program_day_id: number | null;
  status: WorkoutSessionStatus;
  started_at: string | null;
  created_at: string;
}

interface DayRow {
  id: number;
  name: string;
  position: number;
  completed: number;
}

interface ProjectionHeaderRow {
  id: number;
  status: 'active' | 'completed';
  workout_date: string;
  program_id: number | null;
  program_name: string | null;
  phase_id: number | null;
  phase_name: string | null;
  day_id: number | null;
  day_name: string | null;
  day_position: number | null;
  coach_user_id: number | null;
}

interface ProjectionSetRow {
  session_exercise_id: number;
  workout_session_id: number;
  source_program_exercise_id: number | null;
  exercise_position: number;
  exercise_status: SessionExerciseStatus;
  exercise_notes: string | null;
  exercise_id: number;
  exercise_scope: ExerciseScope;
  exercise_name: string;
  exercise_description: string | null;
  tracking_type: TrackingType;
  category_code: ExerciseCategoryCode | null;
  equipment_code: ExerciseEquipmentCode | null;
  reference_source: string | null;
  reference_key: string | null;
  reference_media_url: string | null;
  session_set_id: number | null;
  source_program_set_id: number | null;
  set_position: number | null;
  set_status: SessionSetStatus | null;
  planned_reps: number | null;
  planned_weight: number | null;
  planned_duration_seconds: number | null;
  planned_distance_meters: number | null;
  actual_reps: number | null;
  actual_weight: number | null;
  actual_duration_seconds: number | null;
  actual_distance_meters: number | null;
  set_label: WorkoutSetLabel | null;
  rpe: number | null;
  comment: string | null;
  bands_json: string | null;
  previous_date: string | null;
  previous_reps: number | null;
  previous_weight: number | null;
  previous_duration_seconds: number | null;
  previous_distance_meters: number | null;
}

function metrics(
  weightKg: number | null,
  reps: number | null,
  durationSeconds: number | null,
  distanceMeters: number | null,
): WorkoutMetrics {
  return { weightKg, reps, durationSeconds, distanceMeters };
}

function hasMetrics(value: WorkoutMetrics): boolean {
  return value.weightKg !== null || value.reps !== null || value.durationSeconds !== null || value.distanceMeters !== null;
}

function parseBands(value: string | null): ResistanceBandCode[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<ResistanceBandCode>(['yellow', 'red', 'green', 'blue', 'purple', 'black']);
    return parsed.filter((item): item is ResistanceBandCode => typeof item === 'string' && allowed.has(item as ResistanceBandCode));
  } catch {
    return [];
  }
}

export async function resolveWorkoutProgram(
  db: D1Database,
  userId: number,
  requestedTrainingPlanId: number | null,
): Promise<WorkoutProgramResolution> {
  const baseSql = `
    SELECT
      tp.id AS program_id,
      tp.name AS program_name,
      pp.id AS phase_id,
      pp.name AS phase_name,
      COALESCE(tp.owner_coach_user_id, tp.created_by_user_id) AS coach_user_id
    FROM training_plan tp
    JOIN program_phase pp ON pp.training_plan_id = tp.id AND pp.status = 'active'
    WHERE tp.user_id = ?
  `;

  if (requestedTrainingPlanId !== null) {
    const row = await db
      .prepare(`${baseSql} AND tp.id = ? LIMIT 1`)
      .bind(userId, requestedTrainingPlanId)
      .first<ActiveProgramRow>();
    if (!row) return { kind: 'not_found' };
    return {
      kind: 'selected',
      program: { id: row.program_id, name: row.program_name },
      phase: { id: row.phase_id, name: row.phase_name },
      coachUserId: row.coach_user_id,
    };
  }

  const result = await db
    .prepare(`${baseSql} ORDER BY tp.position, tp.id`)
    .bind(userId)
    .all<ActiveProgramRow>();

  if (result.results.length === 0) return { kind: 'none' };
  if (result.results.length > 1) {
    return {
      kind: 'ambiguous',
      programs: result.results.map((row) => ({ id: row.program_id, name: row.program_name })),
    };
  }

  const row = result.results[0];
  return {
    kind: 'selected',
    program: { id: row.program_id, name: row.program_name },
    phase: { id: row.phase_id, name: row.phase_name },
    coachUserId: row.coach_user_id,
  };
}

async function listPhaseDays(db: D1Database, userId: number, phaseId: number): Promise<WorkoutDayOption[]> {
  const result = await db
    .prepare(`
      SELECT
        pd.id,
        pd.name,
        pd.position,
        CASE WHEN EXISTS (
          SELECT 1
          FROM workout_session ws
          WHERE ws.user_id = ?
            AND ws.status = 'completed'
            AND ws.source_program_day_id = pd.id
        ) THEN 1 ELSE 0 END AS completed
      FROM program_day pd
      WHERE pd.program_phase_id = ? AND pd.status = 'active'
      ORDER BY pd.position, pd.id
    `)
    .bind(userId, phaseId)
    .all<DayRow>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    completed: row.completed === 1,
  }));
}

async function openSession(db: D1Database, userId: number): Promise<WorkoutSessionRow | null> {
  return db
    .prepare(`
      SELECT id, user_id, source_program_phase_id, source_program_day_id, status, started_at, created_at
      FROM workout_session
      WHERE user_id = ? AND status IN ('draft', 'active')
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(userId)
    .first<WorkoutSessionRow>();
}

export async function initializeWorkoutSession(
  db: D1Database,
  userId: number,
  requestedTrainingPlanId: number | null,
): Promise<{ kind: 'ok'; session: WorkoutInitializeResult } | { kind: 'program_not_found' } | { kind: 'program_selection_required'; programs: WorkoutProgramSummary[] }> {
  const existing = await openSession(db, userId);
  if (existing?.status === 'active') {
    const session = await getWorkoutSessionProjection(db, userId, existing.id);
    if (!session) throw new Error('ACTIVE_WORKOUT_PROJECTION_MISSING');
    return { kind: 'ok', session };
  }

  const resolution = await resolveWorkoutProgram(db, userId, requestedTrainingPlanId);
  if (resolution.kind === 'not_found') return { kind: 'program_not_found' };
  if (resolution.kind === 'ambiguous') return { kind: 'program_selection_required', programs: resolution.programs };

  const program = resolution.kind === 'selected' ? resolution.program : null;
  const phase = resolution.kind === 'selected' ? resolution.phase : null;
  const days = phase ? await listPhaseDays(db, userId, phase.id) : [];
  const suggested = days.find((day) => !day.completed) ?? null;

  let draft = existing?.status === 'draft' ? existing : null;
  if (!draft) {
    const inserted = await db
      .prepare(`
        INSERT OR IGNORE INTO workout_session (
          user_id, source_program_phase_id, source_program_day_id, started_by_user_id, status, started_at, completed_at
        ) VALUES (?, ?, ?, ?, 'draft', NULL, NULL)
        RETURNING id, user_id, source_program_phase_id, source_program_day_id, status, started_at, created_at
      `)
      .bind(userId, null, null, userId)
      .first<WorkoutSessionRow>();
    draft = inserted ?? await openSession(db, userId);
  }

  if (!draft) throw new Error('FAILED_TO_INITIALIZE_WORKOUT_SESSION');
  if (draft.status === 'active') {
    const session = await getWorkoutSessionProjection(db, userId, draft.id);
    if (!session) throw new Error('ACTIVE_WORKOUT_PROJECTION_MISSING');
    return { kind: 'ok', session };
  }

  const updateResult = await db
    .prepare(`
      UPDATE workout_session
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status = 'draft'
    `)
    .bind(draft.id, userId)
    .run();

  if ((updateResult.meta?.changes ?? 1) === 0) {
    const current = await workoutRowForUser(db, userId, draft.id);
    if (!current) throw new Error('INITIALIZED_WORKOUT_SESSION_MISSING');
    if (current.status !== 'draft') {
      const canonical = await getWorkoutSessionProjection(db, userId, current.id);
      if (!canonical) throw new Error('OPEN_WORKOUT_PROJECTION_MISSING');
      return { kind: 'ok', session: canonical };
    }
  }

  return {
    kind: 'ok',
    session: {
      sessionId: draft.id,
      status: 'draft',
      program,
      phase,
      suggestedDay: suggested ? { ...suggested, resolution: 'next_incomplete' } : null,
      availableDays: days,
    },
  };
}

async function workoutRowForUser(db: D1Database, userId: number, sessionId: number): Promise<WorkoutSessionRow | null> {
  return db
    .prepare(`
      SELECT id, user_id, source_program_phase_id, source_program_day_id, status, started_at, created_at
      FROM workout_session
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `)
    .bind(sessionId, userId)
    .first<WorkoutSessionRow>();
}

export async function startWorkoutSession(
  db: D1Database,
  userId: number,
  sessionId: number,
  input: WorkoutStartInput,
): Promise<{ kind: 'ok'; session: ActiveWorkoutSession } | { kind: 'not_found' } | { kind: 'invalid_state' } | { kind: 'invalid_program_day' }> {
  const workout = await workoutRowForUser(db, userId, sessionId);
  if (!workout) return { kind: 'not_found' };
  if (workout.status === 'completed') return { kind: 'invalid_state' };
  if (workout.status === 'active') {
    const session = await getWorkoutSessionProjection(db, userId, sessionId);
    if (!session) throw new Error('ACTIVE_WORKOUT_PROJECTION_MISSING');
    return { kind: 'ok', session };
  }

  if (input.type === 'own') {
    await db
      .prepare(`
        UPDATE workout_session
        SET source_program_phase_id = NULL,
            source_program_day_id = NULL,
            status = 'active',
            started_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'draft'
      `)
      .bind(sessionId, userId)
      .run();
  } else {
    const day = await db
      .prepare(`
        SELECT pd.id, pd.program_phase_id AS phase_id
        FROM program_day pd
        JOIN program_phase pp ON pp.id = pd.program_phase_id AND pp.status = 'active'
        JOIN training_plan tp ON tp.id = pp.training_plan_id AND tp.user_id = ?
        WHERE pd.id = ?
          AND pd.status = 'active'
        LIMIT 1
      `)
      .bind(userId, input.programDayId)
      .first<{ id: number; phase_id: number }>();
    if (!day) return { kind: 'invalid_program_day' };

    const statements = [
      db.prepare(`
        INSERT INTO session_exercise (
          workout_session_id, exercise_definition_id, source_program_exercise_id,
          position, status, added_by_user_id, notes
        )
        SELECT ?, pe.exercise_definition_id, pe.id, pe.position, 'planned', ?, pe.notes
        FROM program_exercise pe
        WHERE pe.program_day_id = ?
          AND pe.status = 'active'
          AND EXISTS (
            SELECT 1
            FROM workout_session pending
            WHERE pending.id = ? AND pending.user_id = ? AND pending.status = 'draft'
          )
        ORDER BY pe.position, pe.id
      `).bind(sessionId, userId, day.id, sessionId, userId),
      db.prepare(`
        INSERT INTO session_set (
          session_exercise_id, source_program_set_id, position,
          planned_reps, planned_weight, planned_duration_seconds, planned_distance_meters,
          actual_reps, actual_weight, actual_duration_seconds, actual_distance_meters,
          set_label, rpe, comment, bands_json,
          status, created_by_user_id, updated_by_user_id
        )
        SELECT
          se.id, ps.id, ps.position,
          ps.reps, ps.weight, ps.duration_seconds, ps.distance_meters,
          NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL,
          'pending', ?, ?
        FROM session_exercise se
        JOIN program_set ps ON ps.program_exercise_id = se.source_program_exercise_id AND ps.status = 'active'
        WHERE se.workout_session_id = ?
          AND EXISTS (
            SELECT 1
            FROM workout_session pending
            WHERE pending.id = ? AND pending.user_id = ? AND pending.status = 'draft'
          )
        ORDER BY se.position, ps.position
      `).bind(userId, userId, sessionId, sessionId, userId),
      db.prepare(`
        UPDATE workout_session
        SET source_program_phase_id = ?,
            source_program_day_id = ?,
            status = 'active',
            started_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'draft'
      `).bind(day.phase_id, day.id, sessionId, userId),
    ];
    await db.batch(statements);
  }

  const session = await getWorkoutSessionProjection(db, userId, sessionId);
  if (!session) throw new Error('STARTED_WORKOUT_PROJECTION_MISSING');
  return { kind: 'ok', session };
}

export async function saveWorkoutSet(
  db: D1Database,
  userId: number,
  sessionId: number,
  sessionSetId: number,
  fact: WorkoutSetFactInput,
): Promise<{ kind: 'ok'; session: ActiveWorkoutSession } | { kind: 'not_found' } | { kind: 'invalid_state' }> {
  const row = await db
    .prepare(`
      SELECT ss.id, ss.session_exercise_id
      FROM session_set ss
      JOIN session_exercise se ON se.id = ss.session_exercise_id
      JOIN workout_session ws ON ws.id = se.workout_session_id
      WHERE ss.id = ? AND ws.id = ? AND ws.user_id = ?
      LIMIT 1
    `)
    .bind(sessionSetId, sessionId, userId)
    .first<{ id: number; session_exercise_id: number }>();
  if (!row) return { kind: 'not_found' };

  const workout = await workoutRowForUser(db, userId, sessionId);
  if (!workout || workout.status !== 'active') return { kind: 'invalid_state' };

  await db.batch([
    db.prepare(`
      UPDATE session_set
      SET actual_reps = ?,
          actual_weight = ?,
          actual_duration_seconds = ?,
          actual_distance_meters = ?,
          set_label = ?,
          rpe = ?,
          comment = ?,
          bands_json = ?,
          status = 'completed',
          updated_by_user_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      fact.metrics.reps,
      fact.metrics.weightKg,
      fact.metrics.durationSeconds,
      fact.metrics.distanceMeters,
      fact.setLabel,
      fact.rpe,
      fact.comment,
      JSON.stringify(fact.bands),
      userId,
      sessionSetId,
    ),
    db.prepare(`
      UPDATE session_exercise
      SET status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM session_set pending
          WHERE pending.session_exercise_id = session_exercise.id
            AND pending.status = 'pending'
        ) THEN 'completed'
        ELSE 'active'
      END,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(row.session_exercise_id),
  ]);

  const session = await getWorkoutSessionProjection(db, userId, sessionId);
  if (!session) throw new Error('UPDATED_WORKOUT_PROJECTION_MISSING');
  return { kind: 'ok', session };
}

export async function reorderWorkoutExercises(
  db: D1Database,
  userId: number,
  sessionId: number,
  sessionExerciseIds: number[],
): Promise<{ kind: 'ok'; session: ActiveWorkoutSession } | { kind: 'not_found' } | { kind: 'invalid_state' } | { kind: 'invalid_order' }> {
  const workout = await workoutRowForUser(db, userId, sessionId);
  if (!workout) return { kind: 'not_found' };
  if (workout.status !== 'active') return { kind: 'invalid_state' };

  const result = await db
    .prepare(`SELECT id FROM session_exercise WHERE workout_session_id = ? ORDER BY position, id`)
    .bind(sessionId)
    .all<{ id: number }>();
  const existing = result.results.map(({ id }) => id);
  const uniqueRequested = new Set(sessionExerciseIds);
  if (
    sessionExerciseIds.length !== existing.length
    || uniqueRequested.size !== sessionExerciseIds.length
    || existing.some((id) => !uniqueRequested.has(id))
  ) {
    return { kind: 'invalid_order' };
  }

  if (sessionExerciseIds.length > 0) {
    const caseSql = sessionExerciseIds.map(() => 'WHEN ? THEN ?').join(' ');
    const bindings: Array<number> = [];
    sessionExerciseIds.forEach((id, position) => bindings.push(id, position));
    await db.batch([
      db.prepare(`
        UPDATE session_exercise
        SET position = position + 1000000, updated_at = CURRENT_TIMESTAMP
        WHERE workout_session_id = ?
      `).bind(sessionId),
      db.prepare(`
        UPDATE session_exercise
        SET position = CASE id ${caseSql} ELSE position END,
            updated_at = CURRENT_TIMESTAMP
        WHERE workout_session_id = ?
      `).bind(...bindings, sessionId),
    ]);
  }

  const session = await getWorkoutSessionProjection(db, userId, sessionId);
  if (!session) throw new Error('REORDERED_WORKOUT_PROJECTION_MISSING');
  return { kind: 'ok', session };
}

export async function completeWorkoutSession(
  db: D1Database,
  userId: number,
  sessionId: number,
): Promise<{ kind: 'ok'; session: ActiveWorkoutSession } | { kind: 'not_found' } | { kind: 'invalid_state' }> {
  const workout = await workoutRowForUser(db, userId, sessionId);
  if (!workout) return { kind: 'not_found' };
  if (workout.status === 'completed') {
    const session = await getWorkoutSessionProjection(db, userId, sessionId);
    if (!session) throw new Error('COMPLETED_WORKOUT_PROJECTION_MISSING');
    return { kind: 'ok', session };
  }
  if (workout.status !== 'active') return { kind: 'invalid_state' };

  await db
    .prepare(`
      UPDATE workout_session
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status = 'active'
    `)
    .bind(sessionId, userId)
    .run();

  const session = await getWorkoutSessionProjection(db, userId, sessionId);
  if (!session) throw new Error('COMPLETED_WORKOUT_PROJECTION_MISSING');
  return { kind: 'ok', session };
}

export async function getWorkoutSessionProjection(
  db: D1Database,
  userId: number,
  sessionId: number,
): Promise<ActiveWorkoutSession | null> {
  const header = await db
    .prepare(`
      SELECT
        ws.id,
        ws.status,
        date(COALESCE(ws.started_at, ws.created_at)) AS workout_date,
        tp.id AS program_id,
        tp.name AS program_name,
        pp.id AS phase_id,
        pp.name AS phase_name,
        pd.id AS day_id,
        pd.name AS day_name,
        pd.position AS day_position,
        COALESCE(tp.owner_coach_user_id, tp.created_by_user_id) AS coach_user_id
      FROM workout_session ws
      LEFT JOIN program_phase pp ON pp.id = ws.source_program_phase_id
      LEFT JOIN training_plan tp ON tp.id = pp.training_plan_id
      LEFT JOIN program_day pd ON pd.id = ws.source_program_day_id
      WHERE ws.id = ? AND ws.user_id = ? AND ws.status IN ('active', 'completed')
      LIMIT 1
    `)
    .bind(sessionId, userId)
    .first<ProjectionHeaderRow>();
  if (!header) return null;

  const result = await db
    .prepare(`
      SELECT
        se.id AS session_exercise_id,
        se.workout_session_id,
        se.source_program_exercise_id,
        se.position AS exercise_position,
        se.status AS exercise_status,
        se.notes AS exercise_notes,
        e.id AS exercise_id,
        e.scope AS exercise_scope,
        CASE WHEN o.exercise_definition_id IS NULL THEN e.name ELSE o.name END AS exercise_name,
        CASE WHEN o.exercise_definition_id IS NULL THEN e.description ELSE o.description END AS exercise_description,
        CASE WHEN o.exercise_definition_id IS NULL THEN e.tracking_type ELSE o.tracking_type END AS tracking_type,
        CASE WHEN o.exercise_definition_id IS NULL THEN e.category_code ELSE o.category_code END AS category_code,
        CASE WHEN o.exercise_definition_id IS NULL THEN e.equipment_code ELSE o.equipment_code END AS equipment_code,
        e.reference_source,
        e.reference_key,
        e.reference_media_url,
        ss.id AS session_set_id,
        ss.source_program_set_id,
        ss.position AS set_position,
        ss.status AS set_status,
        ss.planned_reps,
        ss.planned_weight,
        ss.planned_duration_seconds,
        ss.planned_distance_meters,
        ss.actual_reps,
        ss.actual_weight,
        ss.actual_duration_seconds,
        ss.actual_distance_meters,
        ss.set_label,
        ss.rpe,
        ss.comment,
        ss.bands_json,
        date(prev_ws.started_at) AS previous_date,
        prev_ss.actual_reps AS previous_reps,
        prev_ss.actual_weight AS previous_weight,
        prev_ss.actual_duration_seconds AS previous_duration_seconds,
        prev_ss.actual_distance_meters AS previous_distance_meters
      FROM session_exercise se
      JOIN workout_session current_ws ON current_ws.id = se.workout_session_id
      JOIN exercise_definition e ON e.id = se.exercise_definition_id
      LEFT JOIN exercise_definition_override o
        ON o.exercise_definition_id = e.id AND o.coach_user_id = ?
      LEFT JOIN session_set ss ON ss.session_exercise_id = se.id
      LEFT JOIN session_set prev_ss ON prev_ss.id = (
        SELECT candidate_set.id
        FROM workout_session candidate_workout
        JOIN session_exercise candidate_exercise
          ON candidate_exercise.workout_session_id = candidate_workout.id
          AND candidate_exercise.exercise_definition_id = se.exercise_definition_id
        JOIN session_set candidate_set
          ON candidate_set.session_exercise_id = candidate_exercise.id
          AND candidate_set.position = ss.position
          AND candidate_set.status = 'completed'
        WHERE candidate_workout.user_id = current_ws.user_id
          AND candidate_workout.id <> current_ws.id
          AND candidate_workout.status = 'completed'
          AND candidate_workout.completed_at < current_ws.started_at
        ORDER BY candidate_workout.completed_at DESC, candidate_workout.id DESC
        LIMIT 1
      )
      LEFT JOIN session_exercise prev_se ON prev_se.id = prev_ss.session_exercise_id
      LEFT JOIN workout_session prev_ws ON prev_ws.id = prev_se.workout_session_id
      WHERE se.workout_session_id = ?
      ORDER BY se.position, se.id, ss.position, ss.id
    `)
    .bind(header.coach_user_id ?? -1, sessionId)
    .all<ProjectionSetRow>();

  const exerciseMap = new Map<number, WorkoutSessionExerciseData>();
  for (const row of result.results) {
    let exercise = exerciseMap.get(row.session_exercise_id);
    if (!exercise) {
      exercise = {
        sessionExerciseId: row.session_exercise_id,
        workoutSessionId: row.workout_session_id,
        sourceProgramExerciseId: row.source_program_exercise_id,
        position: row.exercise_position,
        status: row.exercise_status,
        notes: row.exercise_notes,
        exercise: {
          id: row.exercise_id,
          scope: row.exercise_scope,
          name: row.exercise_name,
          description: row.exercise_description,
          tracking_type: row.tracking_type,
          category_code: row.category_code,
          equipment_code: row.equipment_code,
          reference_source: row.reference_source,
          reference_key: row.reference_key,
          reference_media_url: row.reference_media_url,
          is_favourite: false,
          can_edit: false,
        },
        sets: [],
      };
      exerciseMap.set(row.session_exercise_id, exercise);
    }

    if (row.session_set_id === null || row.set_position === null || row.set_status === null) continue;
    const planMetrics = metrics(
      row.planned_weight,
      row.planned_reps,
      row.planned_duration_seconds,
      row.planned_distance_meters,
    );
    const factMetrics = metrics(
      row.actual_weight,
      row.actual_reps,
      row.actual_duration_seconds,
      row.actual_distance_meters,
    );
    const previousMetrics = metrics(
      row.previous_weight,
      row.previous_reps,
      row.previous_duration_seconds,
      row.previous_distance_meters,
    );

    exercise.sets.push({
      sessionSetId: row.session_set_id,
      sourceProgramSetId: row.source_program_set_id,
      position: row.set_position,
      status: row.set_status,
      plan: hasMetrics(planMetrics) ? planMetrics : null,
      previous: row.previous_date && hasMetrics(previousMetrics)
        ? { workoutDate: row.previous_date, metrics: previousMetrics }
        : null,
      fact: row.set_status === 'completed'
        ? {
            metrics: factMetrics,
            setLabel: row.set_label,
            rpe: row.rpe,
            comment: row.comment,
            bands: parseBands(row.bands_json),
          }
        : null,
    });
  }

  return {
    sessionId: header.id,
    status: header.status,
    workoutDate: header.workout_date,
    program: header.program_id !== null && header.program_name !== null
      ? { id: header.program_id, name: header.program_name }
      : null,
    phase: header.phase_id !== null && header.phase_name !== null
      ? { id: header.phase_id, name: header.phase_name }
      : null,
    day: header.day_id !== null && header.day_name !== null && header.day_position !== null
      ? { id: header.day_id, name: header.day_name, position: header.day_position }
      : null,
    exercises: [...exerciseMap.values()],
  };
}
