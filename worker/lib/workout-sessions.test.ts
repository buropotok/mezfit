import { describe, expect, it, vi } from 'vitest';
import {
  getWorkoutSessionProjection,
  initializeWorkoutSession,
  resolveWorkoutProgram,
  startWorkoutSession,
} from './workout-sessions';

describe('resolveWorkoutProgram', () => {
  it('requires the external workflow to resolve multiple active programs instead of choosing one', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        { program_id: 10, program_name: 'Программа A', phase_id: 100, phase_name: 'Фаза A', coach_user_id: 1 },
        { program_id: 20, program_name: 'Программа B', phase_id: 200, phase_name: 'Фаза B', coach_user_id: 2 },
      ],
    });
    const prepare = vi.fn((sql: string) => ({ bind: vi.fn().mockReturnValue({ all }) }));
    const db = { prepare } as unknown as D1Database;

    await expect(resolveWorkoutProgram(db, 7, null)).resolves.toEqual({
      kind: 'ambiguous',
      programs: [
        { id: 10, name: 'Программа A' },
        { id: 20, name: 'Программа B' },
      ],
    });
    expect(prepare.mock.calls[0]?.[0]).not.toContain('tp.status');
  });
});

describe('initializeWorkoutSession', () => {
  it('creates an idempotent draft id before workout type selection and does not materialize exercises', async () => {
    const openFirst = vi.fn().mockResolvedValue(null);
    const programsAll = vi.fn().mockResolvedValue({ results: [] });
    const insertFirst = vi.fn().mockResolvedValue({
      id: 501,
      user_id: 7,
      source_program_phase_id: null,
      source_program_day_id: null,
      status: 'draft',
      started_at: null,
      created_at: '2026-09-15 18:00:00',
    });
    const updateRun = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("WHERE user_id = ? AND status IN ('draft', 'active')")) {
        return { bind: vi.fn().mockReturnValue({ first: openFirst }) };
      }
      if (sql.includes('FROM training_plan tp')) {
        return { bind: vi.fn().mockReturnValue({ all: programsAll }) };
      }
      if (sql.includes('INSERT OR IGNORE INTO workout_session')) {
        return { bind: vi.fn().mockReturnValue({ first: insertFirst }) };
      }
      if (sql.includes('UPDATE workout_session')) {
        return { bind: vi.fn().mockReturnValue({ run: updateRun }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const batch = vi.fn();
    const db = { prepare, batch } as unknown as D1Database;

    await expect(initializeWorkoutSession(db, 7, null)).resolves.toEqual({
      kind: 'ok',
      session: {
        sessionId: 501,
        status: 'draft',
        program: null,
        phase: null,
        suggestedDay: null,
        availableDays: [],
      },
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it('reuses the same draft on repeated initialization instead of inserting another open session', async () => {
    const draftRow = {
      id: 501,
      user_id: 7,
      source_program_phase_id: null,
      source_program_day_id: null,
      status: 'draft',
      started_at: null,
      created_at: '2026-09-15 18:00:00',
    };
    const openFirst = vi.fn().mockResolvedValue(draftRow);
    const programsAll = vi.fn().mockResolvedValue({ results: [] });
    const updateRun = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("WHERE user_id = ? AND status IN ('draft', 'active')")) {
        return { bind: vi.fn().mockReturnValue({ first: openFirst }) };
      }
      if (sql.includes('FROM training_plan tp')) {
        return { bind: vi.fn().mockReturnValue({ all: programsAll }) };
      }
      if (sql.includes('INSERT OR IGNORE INTO workout_session')) {
        throw new Error('Repeated initialization must not insert a second draft');
      }
      if (sql.includes('UPDATE workout_session')) {
        return { bind: vi.fn().mockReturnValue({ run: updateRun }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const batch = vi.fn();
    const db = { prepare, batch } as unknown as D1Database;

    const first = await initializeWorkoutSession(db, 7, null);
    const second = await initializeWorkoutSession(db, 7, null);

    expect(first).toMatchObject({ kind: 'ok', session: { sessionId: 501, status: 'draft' } });
    expect(second).toMatchObject({ kind: 'ok', session: { sessionId: 501, status: 'draft' } });
    expect(openFirst).toHaveBeenCalledTimes(2);
    expect(batch).not.toHaveBeenCalled();
  });

  it('returns the canonical active session when start wins a race with draft initialization', async () => {
    const draftRow = {
      id: 501,
      user_id: 7,
      source_program_phase_id: null,
      source_program_day_id: null,
      status: 'draft',
      started_at: null,
      created_at: '2026-09-15 18:00:00',
    };
    const activeRow = {
      ...draftRow,
      status: 'active',
      started_at: '2026-09-15 18:01:00',
    };
    const openFirst = vi.fn().mockResolvedValue(draftRow);
    const programsAll = vi.fn().mockResolvedValue({ results: [] });
    const updateRun = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const currentFirst = vi.fn().mockResolvedValue(activeRow);
    const headerFirst = vi.fn().mockResolvedValue({
      id: 501,
      status: 'active',
      workout_date: '2026-09-15',
      program_id: null,
      program_name: null,
      phase_id: null,
      phase_name: null,
      day_id: null,
      day_name: null,
      day_position: null,
      coach_user_id: null,
    });
    const exercisesAll = vi.fn().mockResolvedValue({ results: [] });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("WHERE user_id = ? AND status IN ('draft', 'active')")) {
        return { bind: vi.fn().mockReturnValue({ first: openFirst }) };
      }
      if (sql.includes('FROM training_plan tp')) {
        return { bind: vi.fn().mockReturnValue({ all: programsAll }) };
      }
      if (sql.includes('UPDATE workout_session')) {
        return { bind: vi.fn().mockReturnValue({ run: updateRun }) };
      }
      if (sql.includes('FROM workout_session') && sql.includes('WHERE id = ? AND user_id = ?')) {
        return { bind: vi.fn().mockReturnValue({ first: currentFirst }) };
      }
      if (sql.includes('FROM workout_session ws')) {
        return { bind: vi.fn().mockReturnValue({ first: headerFirst }) };
      }
      if (sql.includes('FROM session_exercise se')) {
        return { bind: vi.fn().mockReturnValue({ all: exercisesAll }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const db = { prepare } as unknown as D1Database;

    await expect(initializeWorkoutSession(db, 7, null)).resolves.toEqual({
      kind: 'ok',
      session: {
        sessionId: 501,
        status: 'active',
        workoutDate: '2026-09-15',
        program: null,
        phase: null,
        day: null,
        exercises: [],
      },
    });
  });
});

describe('startWorkoutSession', () => {
  it('activates an own workout without creating PLAN/PREVIOUS children', async () => {
    const workoutFirst = vi.fn().mockResolvedValue({
      id: 501,
      user_id: 7,
      source_program_phase_id: 30,
      source_program_day_id: 40,
      status: 'draft',
      started_at: null,
      created_at: '2026-09-15 18:00:00',
    });
    const updateRun = vi.fn().mockResolvedValue({ success: true });
    const headerFirst = vi.fn().mockResolvedValue({
      id: 501,
      status: 'active',
      workout_date: '2026-09-15',
      program_id: null,
      program_name: null,
      phase_id: null,
      phase_name: null,
      day_id: null,
      day_name: null,
      day_position: null,
      coach_user_id: null,
    });
    const exercisesAll = vi.fn().mockResolvedValue({ results: [] });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM workout_session') && sql.includes('WHERE id = ? AND user_id = ?')) {
        return { bind: vi.fn().mockReturnValue({ first: workoutFirst }) };
      }
      if (sql.includes('UPDATE workout_session')) {
        return { bind: vi.fn().mockReturnValue({ run: updateRun }) };
      }
      if (sql.includes('FROM workout_session ws')) {
        return { bind: vi.fn().mockReturnValue({ first: headerFirst }) };
      }
      if (sql.includes('FROM session_exercise se')) {
        return { bind: vi.fn().mockReturnValue({ all: exercisesAll }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const batch = vi.fn();
    const db = { prepare, batch } as unknown as D1Database;

    const result = await startWorkoutSession(db, 7, 501, { type: 'own' });

    expect(result).toEqual({
      kind: 'ok',
      session: {
        sessionId: 501,
        status: 'active',
        workoutDate: '2026-09-15',
        program: null,
        phase: null,
        day: null,
        exercises: [],
      },
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it('guards program materialization so repeated start requests cannot duplicate children', async () => {
    const workoutFirst = vi.fn().mockResolvedValue({
      id: 501,
      user_id: 7,
      source_program_phase_id: 30,
      source_program_day_id: 40,
      status: 'draft',
      started_at: null,
      created_at: '2026-09-15 18:00:00',
    });
    const dayFirst = vi.fn().mockResolvedValue({ id: 40, phase_id: 30 });
    const headerFirst = vi.fn().mockResolvedValue({
      id: 501,
      status: 'active',
      workout_date: '2026-09-15',
      program_id: 20,
      program_name: 'Силовой блок',
      phase_id: 30,
      phase_name: 'Фаза 1',
      day_id: 40,
      day_name: 'День B',
      day_position: 1,
      coach_user_id: 9,
    });
    const exercisesAll = vi.fn().mockResolvedValue({ results: [] });
    const batchStatements: { sql: string }[] = [];
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM workout_session') && sql.includes('WHERE id = ? AND user_id = ?')) {
        return { bind: vi.fn().mockReturnValue({ first: workoutFirst }) };
      }
      if (sql.includes('SELECT pd.id, pd.program_phase_id AS phase_id')) {
        return { bind: vi.fn().mockReturnValue({ first: dayFirst }) };
      }
      if (sql.includes('INSERT INTO session_exercise') || sql.includes('INSERT INTO session_set') || sql.includes('UPDATE workout_session')) {
        return { bind: vi.fn().mockImplementation(() => {
          const statement = { sql };
          batchStatements.push(statement);
          return statement;
        }) };
      }
      if (sql.includes('FROM workout_session ws')) {
        return { bind: vi.fn().mockReturnValue({ first: headerFirst }) };
      }
      if (sql.includes('FROM session_exercise se')) {
        return { bind: vi.fn().mockReturnValue({ all: exercisesAll }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const batch = vi.fn().mockResolvedValue([]);
    const db = { prepare, batch } as unknown as D1Database;

    await expect(startWorkoutSession(db, 7, 501, { type: 'program', programDayId: 40 })).resolves.toMatchObject({
      kind: 'ok',
      session: { sessionId: 501, status: 'active' },
    });

    const daySql = prepare.mock.calls.find(([sql]) => sql.includes('SELECT pd.id, pd.program_phase_id AS phase_id'))?.[0];
    expect(daySql).toBeDefined();
    expect(daySql).not.toContain('tp.status');
    expect(batch).toHaveBeenCalledOnce();
    expect(batchStatements).toHaveLength(3);
    expect(batchStatements[0]?.sql).toContain("pending.status = 'draft'");
    expect(batchStatements[1]?.sql).toContain("pending.status = 'draft'");
    expect(batchStatements[2]?.sql).toContain("WHERE id = ? AND user_id = ? AND status = 'draft'");
  });
});

describe('getWorkoutSessionProjection', () => {
  it('resolves PREVIOUS only from a completed matching set', async () => {
    const headerFirst = vi.fn().mockResolvedValue({
      id: 501,
      status: 'active',
      workout_date: '2026-09-15',
      program_id: 20,
      program_name: 'Силовой блок',
      phase_id: 30,
      phase_name: 'Фаза 1',
      day_id: 40,
      day_name: 'День B',
      day_position: 1,
      coach_user_id: 9,
    });
    const exercisesAll = vi.fn().mockResolvedValue({ results: [] });
    let projectionSql = '';
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM workout_session ws')) {
        return { bind: vi.fn().mockReturnValue({ first: headerFirst }) };
      }
      if (sql.includes('FROM session_exercise se')) {
        projectionSql = sql;
        return { bind: vi.fn().mockReturnValue({ all: exercisesAll }) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const db = { prepare } as unknown as D1Database;

    await expect(getWorkoutSessionProjection(db, 7, 501)).resolves.toMatchObject({
      sessionId: 501,
      status: 'active',
      exercises: [],
    });

    expect(projectionSql).toContain('JOIN session_set candidate_set');
    expect(projectionSql).toContain("candidate_set.status = 'completed'");
    expect(projectionSql).not.toContain('LEFT JOIN session_set candidate_set');
  });
});
