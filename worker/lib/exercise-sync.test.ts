import { describe, expect, it } from 'vitest';
import {
  applyExerciseCoachSync,
  parseExerciseCoachSyncRequest,
  type ExerciseCoachSyncRequest,
} from './exercise-sync';

type Prepared = {
  sql: string;
  args: unknown[];
  bind: (...args: unknown[]) => Prepared;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<Record<string, never>>;
};

class FakeSyncDb {
  revision = 0;
  batchCount = 0;
  requests = new Map<string, number>();
  visibleRows: Array<{
    id: number;
    sync_id: string;
    scope: 'global' | 'coach';
    owner_coach_user_id: number | null;
    is_archived: number;
    name: string;
  }> = [];

  prepare(sql: string): Prepared {
    const statement: Prepared = {
      sql,
      args: [],
      bind: (...args: unknown[]) => {
        statement.args = args;
        return statement;
      },
      first: async <T>() => {
        const normalized = sql.replace(/\s+/g, ' ');
        if (normalized.includes('SELECT response_revision FROM sync_request')) {
          const requestId = String(statement.args[0]);
          const responseRevision = this.requests.get(requestId);
          return (responseRevision === undefined ? null : {
            response_revision: responseRevision,
          }) as T | null;
        }
        if (normalized.includes('SELECT revision FROM sync_scope_revision')) {
          return { revision: this.revision } as T;
        }
        return null;
      },
      all: async <T>() => {
        if (sql.includes('FROM exercise_definition') && sql.includes('sync_id IS NOT NULL')) {
          return { results: this.visibleRows as T[] };
        }
        return { results: [] };
      },
      run: async () => ({}),
    };
    return statement;
  }

  async batch(statements: Prepared[]): Promise<unknown[]> {
    this.batchCount += 1;
    const guard = statements.find((statement) => statement.sql.includes('sync_cas_assert'));
    if (!guard) throw new Error('missing CAS guard');
    const requestId = String(guard.args[0]);
    const baseRevision = Number(guard.args[1]);
    if (baseRevision !== this.revision) throw new Error('CHECK constraint failed');

    const revisionUpdate = statements.find(
      (statement) => statement.sql.includes('UPDATE sync_scope_revision')
        && statement.sql.includes('SET revision = ?'),
    );
    if (!revisionUpdate) throw new Error('missing revision update');
    const nextRevision = Number(revisionUpdate.args[0]);

    const requestInsert = statements.find(
      (statement) => statement.sql.includes('INSERT INTO sync_request'),
    );
    if (!requestInsert) throw new Error('missing idempotency record');

    this.revision = nextRevision;
    this.requests.set(requestId, nextRevision);
    return [];
  }
}

function request(overrides: Partial<ExerciseCoachSyncRequest> = {}): ExerciseCoachSyncRequest {
  return {
    requestId: 'request-1234',
    scopeKey: 'exercise-coach:7',
    baseServerRevision: 0,
    snapshot: {
      definitions: [{
        syncId: 'local-1',
        name: 'Моё упражнение',
        description: null,
        trackingType: 'weight_reps',
        categoryCode: 'chest',
        equipmentCode: 'barbell',
      }],
      overrides: [],
      favourites: ['local-1'],
    },
    ...overrides,
  };
}

describe('exercise coach sync', () => {
  it('validates the actor-scoped snapshot request', () => {
    expect(parseExerciseCoachSyncRequest(request())).toEqual(request());
    expect(() => parseExerciseCoachSyncRequest({
      ...request(),
      scopeKey: 'exercise-coach:other',
    })).toThrow('Sync scope is invalid');
  });

  it('advances the revision through one atomic CAS batch', async () => {
    const fake = new FakeSyncDb();

    const result = await applyExerciseCoachSync(
      fake as unknown as D1Database,
      7,
      request(),
    );

    expect(result).toEqual({ ok: true, revision: 1 });
    expect(fake.revision).toBe(1);
    expect(fake.batchCount).toBe(1);
  });

  it('returns the current revision when the base revision is stale', async () => {
    const fake = new FakeSyncDb();
    fake.revision = 2;

    const result = await applyExerciseCoachSync(
      fake as unknown as D1Database,
      7,
      request({ baseServerRevision: 1 }),
    );

    expect(result).toEqual({ ok: false, revision: 2 });
    expect(fake.revision).toBe(2);
  });

  it('returns the original acknowledgement when the same request is retried', async () => {
    const fake = new FakeSyncDb();

    const first = await applyExerciseCoachSync(
      fake as unknown as D1Database,
      7,
      request(),
    );
    const second = await applyExerciseCoachSync(
      fake as unknown as D1Database,
      7,
      request(),
    );

    expect(first).toEqual({ ok: true, revision: 1 });
    expect(second).toEqual(first);
    expect(fake.batchCount).toBe(1);
  });

  it('rejects a scope key that belongs to another actor', async () => {
    const fake = new FakeSyncDb();

    await expect(applyExerciseCoachSync(
      fake as unknown as D1Database,
      7,
      request({ scopeKey: 'exercise-coach:8' }),
    )).rejects.toMatchObject({ code: 'SYNC_SCOPE_FORBIDDEN' });
  });
});
