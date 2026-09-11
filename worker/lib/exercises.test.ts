import { describe, expect, it } from 'vitest';
import {
  archiveExerciseForCoach,
  canCoachMutateExercise,
  getExerciseForCoach,
  listExercisesForClient,
  listExercisesForCoach,
  updateExerciseForCoach,
} from './exercises';

interface CapturedQuery { sql: string; args: unknown[] }

class FakeDb {
  rows: unknown[] = [];
  firstRows: unknown[] = [];
  queries: CapturedQuery[] = [];
  runCount = 0;

  prepare(sql: string) {
    const query = { sql, args: [] } as CapturedQuery;
    this.queries.push(query);
    const statement = {
      all: async <T>() => ({ results: this.rows as T[] }),
      first: async <T>() => (this.firstRows.length ? this.firstRows.shift() : null) as T | null,
      run: async () => { this.runCount++; return {}; },
    };
    return {
      bind: (...args: unknown[]) => { query.args = args; return statement; },
      ...statement,
    };
  }
}

const globalRow = {
  id: 1,
  scope: 'global',
  owner_coach_user_id: null,
  name: 'Жим штанги лёжа',
  name_en: 'Barbell Bench Press',
  description: 'Каноническое описание',
  tracking_type: 'weight_reps',
  category_code: 'chest',
  equipment_code: 'barbell',
  reference_source: 'github_exercises_dataset',
  reference_key: '0001',
  reference_media_url: 'https://media.example/0001.gif',
  reference_order: 3,
  is_favourite: 0,
};

const filters = { search: '', categoryCode: '', trackingType: '', favouritesOnly: false, sort: 'alphabetical' } as const;
const normalizedSql = (sql: string) => sql.replace(/\s+/g, ' ');

describe('global exercise catalogue', () => {
  it('allows direct mutation only for the owning coach definition', () => {
    expect(canCoachMutateExercise('global', null, 7)).toBe(false);
    expect(canCoachMutateExercise('client', 7, 7)).toBe(false);
    expect(canCoachMutateExercise('coach', 8, 7)).toBe(false);
    expect(canCoachMutateExercise('coach', 7, 7)).toBe(true);
  });

  it('searches bundled exercises by both Russian effective name and canonical English name_en', async () => {
    const db = new FakeDb();
    db.rows = [globalRow, { ...globalRow, id: 2, name: 'Тяга верхнего блока', name_en: 'Lat Pulldown' }];
    const russian = await listExercisesForCoach(db as unknown as D1Database, 7, { ...filters, search: 'жим' });
    expect(russian.map((item) => item.id)).toEqual([1]);

    const dbEnglish = new FakeDb();
    dbEnglish.rows = db.rows;
    const english = await listExercisesForCoach(dbEnglish as unknown as D1Database, 7, { ...filters, search: 'bench' });
    expect(english.map((item) => item.id)).toEqual([1]);
    expect(dbEnglish.queries[0].sql).toContain('e.name_en');
  });

  it('stores a bundled edit in the coach-local override table without updating the canonical definition', async () => {
    const db = new FakeDb();
    db.firstRows = [{ id: 1, scope: 'global', owner_coach_user_id: null }, { ...globalRow, name: 'Мой жим' }];
    await updateExerciseForCoach(db as unknown as D1Database, 7, 1, {
      name: 'Мой жим', description: 'Техника', trackingType: 'weight_reps', categoryCode: 'chest', equipmentCode: 'barbell',
    });
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO exercise_definition_override'))).toBe(true);
    expect(db.queries.some((query) => /UPDATE\s+exercise_definition\s+SET/i.test(query.sql))).toBe(false);
  });

  it('scopes overrides by coach so coach A and coach B use different overlay joins', async () => {
    const coachA = new FakeDb(); coachA.rows = [globalRow];
    const coachB = new FakeDb(); coachB.rows = [globalRow];
    await listExercisesForCoach(coachA as unknown as D1Database, 7, filters);
    await listExercisesForCoach(coachB as unknown as D1Database, 8, filters);
    expect(normalizedSql(coachA.queries[0].sql)).toContain('o.coach_user_id=?');
    expect(coachA.queries[0].args[0]).toBe(7);
    expect(coachB.queries[0].args[0]).toBe(8);
  });

  it('applies the coach override in the client catalogue', async () => {
    const db = new FakeDb(); db.rows = [{ ...globalRow, name: 'Жим тренера' }];
    const result = await listExercisesForClient(db as unknown as D1Database, 7, 42, '');
    expect(result[0].name).toBe('Жим тренера');
    expect(normalizedSql(db.queries[0].sql)).toContain('o.coach_user_id=?');
    expect(db.queries[0].args.slice(0, 5)).toEqual([7, 7, 7, 7, 42]);
  });

  it('filters category and tracking type on effective override values', async () => {
    const db = new FakeDb(); db.rows = [globalRow];
    await listExercisesForCoach(db as unknown as D1Database, 7, { ...filters, categoryCode: 'back', trackingType: 'time' });
    const sql = normalizedSql(db.queries[0].sql);
    expect(sql).toContain("CASE WHEN o.exercise_definition_id IS NULL THEN e.category_code ELSE o.category_code END=?");
    expect(sql).toContain("CASE WHEN o.exercise_definition_id IS NULL THEN e.tracking_type ELSE o.tracking_type END=?");
    expect(db.queries[0].args).toEqual([7, 7, 7, 'back', 'back', 'time', 'time', 0, 'alphabetical', 'alphabetical']);
  });

  it('preserves an explicitly cleared override description instead of falling back to canonical text', async () => {
    const db = new FakeDb(); db.firstRows = [{ ...globalRow, description: null }];
    const result = await getExerciseForCoach(db as unknown as D1Database, 7, 1);
    expect(result?.description).toBeNull();
    expect(normalizedSql(db.queries[0].sql)).toContain('CASE WHEN o.exercise_definition_id IS NULL THEN e.description ELSE o.description END AS description');
    expect(db.queries[0].sql).not.toContain('COALESCE(o.description,e.description)');
  });

  it('sorts renamed bundled exercises by effective name', async () => {
    const db = new FakeDb(); db.rows = [globalRow];
    await listExercisesForCoach(db as unknown as D1Database, 7, filters);
    expect(normalizedSql(db.queries[0].sql)).toContain('CASE WHEN o.exercise_definition_id IS NULL THEN e.name ELSE o.name END COLLATE NOCASE');
  });

  it('keeps canonical reference and media identity after applying an override', async () => {
    const db = new FakeDb(); db.firstRows = [{ ...globalRow, name: 'Переименованный жим', description: null }];
    const result = await getExerciseForCoach(db as unknown as D1Database, 7, 1);
    expect(result).toMatchObject({
      reference_source: 'github_exercises_dataset',
      reference_key: '0001',
      reference_media_url: 'https://media.example/0001.gif',
    });
    const sql = normalizedSql(db.queries[0].sql);
    expect(sql).toContain('e.reference_source,e.reference_key,e.reference_media_url');
  });

  it('refuses to archive a bundled global definition', async () => {
    const db = new FakeDb(); db.firstRows = [{ id: 9, scope: 'global', owner_coach_user_id: null }];
    const archived = await archiveExerciseForCoach(db as unknown as D1Database, 7, 9);
    expect(archived).toBe(false);
    expect(db.runCount).toBe(0);
  });

  it('continues to edit coach-created exercises directly', async () => {
    const db = new FakeDb();
    db.firstRows = [
      { id: 9, scope: 'coach', owner_coach_user_id: 7 },
      null,
      { ...globalRow, id: 9, scope: 'coach', owner_coach_user_id: 7, name: 'Моё упражнение', reference_source: null, reference_key: null, reference_media_url: null },
    ];
    const result = await updateExerciseForCoach(db as unknown as D1Database, 7, 9, {
      name: 'Моё упражнение', description: null, trackingType: 'time', categoryCode: 'other', equipmentCode: 'other',
    });
    expect(result).not.toBe('forbidden');
    expect(db.queries.some((query) => /UPDATE\s+exercise_definition\s+SET/i.test(query.sql))).toBe(true);
    expect(db.queries.some((query) => query.sql.includes('INSERT INTO exercise_definition_override'))).toBe(false);
  });
});
