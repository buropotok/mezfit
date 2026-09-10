import { describe, expect, it } from 'vitest';
import {
  archiveExerciseForCoach,
  canCoachMutateExercise,
  listExercisesForCoach,
} from './exercises';

interface CapturedQuery {
  sql: string;
  args: unknown[];
}

class FakeDb {
  rows: unknown[] = [];
  firstRow: unknown = null;
  queries: CapturedQuery[] = [];
  runCount = 0;

  prepare(sql: string) {
    const query: CapturedQuery = { sql, args: [] };
    this.queries.push(query);
    return {
      bind: (...args: unknown[]) => {
        query.args = args;
        return {
          all: async <T>() => ({ results: this.rows as T[] }),
          first: async <T>() => this.firstRow as T | null,
          run: async () => {
            this.runCount += 1;
            return {};
          },
        };
      },
      all: async <T>() => ({ results: this.rows as T[] }),
      first: async <T>() => this.firstRow as T | null,
      run: async () => {
        this.runCount += 1;
        return {};
      },
    };
  }
}

describe('global exercise catalogue', () => {
  it('allows mutation only for the owning coach definition', () => {
    expect(canCoachMutateExercise('global', null, 7)).toBe(false);
    expect(canCoachMutateExercise('client', 7, 7)).toBe(false);
    expect(canCoachMutateExercise('coach', 8, 7)).toBe(false);
    expect(canCoachMutateExercise('coach', 7, 7)).toBe(true);
  });

  it('queries only GLOBAL plus own COACH definitions with search/filter/favourite/sort controls', async () => {
    const db = new FakeDb();
    db.rows = [
      {
        id: 1,
        scope: 'global',
        owner_coach_user_id: null,
        name: 'Barbell Bench Press',
        description: null,
        tracking_type: 'weight_reps',
        category_code: 'chest',
        equipment_code: 'barbell',
        reference_source: 'gym_keeper_apk',
        reference_key: 'bench.gif',
        reference_media_url: null,
        reference_order: 3,
        is_favourite: 1,
      },
      {
        id: 2,
        scope: 'coach',
        owner_coach_user_id: 7,
        name: 'My Bench Variation',
        description: 'Custom',
        tracking_type: 'weight_reps',
        category_code: 'chest',
        equipment_code: 'barbell',
        reference_source: null,
        reference_key: null,
        reference_media_url: null,
        reference_order: null,
        is_favourite: 0,
      },
    ];

    const result = await listExercisesForCoach(db as unknown as D1Database, 7, {
      search: 'bench',
      categoryCode: 'chest',
      trackingType: 'weight_reps',
      favouritesOnly: true,
      sort: 'reference',
    });

    expect(db.queries[0].sql).toContain("e.scope = 'global' OR (e.scope = 'coach' AND e.owner_coach_user_id = ?)");
    expect(db.queries[0].sql).not.toContain("e.scope = 'client'");
    expect(db.queries[0].sql).toContain('e.category_code = ?');
    expect(db.queries[0].sql).toContain('e.tracking_type = ?');
    expect(db.queries[0].sql).toContain('f.exercise_definition_id IS NOT NULL');
    expect(db.queries[0].args).toEqual([
      7,
      7,
      'bench',
      '%bench%',
      'chest',
      'chest',
      'weight_reps',
      'weight_reps',
      1,
      'reference',
      'reference',
    ]);
    expect(result[0]).toMatchObject({ id: 1, is_favourite: true, can_edit: false });
    expect(result[1]).toMatchObject({ id: 2, is_favourite: false, can_edit: true });
  });

  it('refuses to archive a bundled global definition', async () => {
    const db = new FakeDb();
    db.firstRow = { id: 9, scope: 'global', owner_coach_user_id: null };

    const archived = await archiveExerciseForCoach(db as unknown as D1Database, 7, 9);

    expect(archived).toBe(false);
    expect(db.runCount).toBe(0);
  });
});
