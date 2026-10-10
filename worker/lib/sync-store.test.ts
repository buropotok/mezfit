import { describe, expect, it } from 'vitest';
import {
  applySyncBatch,
  bumpSyncScopeRevision,
  SYNC_REQUEST_RETENTION_REVISIONS,
  SyncRequestReuseError,
  validateSyncEnvelopeMetadata,
} from './sync-store';

class FakeStatement {
  args: unknown[] = [];

  constructor(
    readonly db: FakeDb,
    readonly sql: string,
  ) {}

  bind(...args: unknown[]): FakeStatement {
    const statement = new FakeStatement(this.db, this.sql);
    statement.args = args;
    return statement;
  }

  async run(): Promise<unknown> {
    this.db.run(this);
    return { success: true, results: [], meta: {} };
  }

  async first<T>(): Promise<T | null> {
    return this.db.first(this) as T | null;
  }
}

class FakeDb {
  readonly revisions = new Map<string, number>();
  readonly requests = new Map<string, {
    scopeKey: string;
    baseRevision: number;
    fingerprint: string;
    revision: number;
  }>();
  domainMutationCount = 0;
  raceRevisionOnBatch: number | null = null;

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    if (this.raceRevisionOnBatch !== null) {
      const assertion = statements[0] as unknown as FakeStatement;
      const scopeKey = String(assertion.args[2]);
      this.revisions.set(scopeKey, this.raceRevisionOnBatch);
      this.raceRevisionOnBatch = null;
    }

    const revisionBackup = new Map(this.revisions);
    const requestBackup = new Map(this.requests);
    const mutationBackup = this.domainMutationCount;

    try {
      for (const raw of statements) {
        const statement = raw as unknown as FakeStatement;
        const sql = statement.sql.replace(/\s+/g, ' ').trim();

        if (sql.startsWith('INSERT INTO sync_cas_assert')) {
          const base = Number(statement.args[1]);
          const scopeKey = String(statement.args[2]);
          if ((this.revisions.get(scopeKey) ?? 0) !== base) {
            throw new Error('CHECK constraint failed: sync_cas_assert.ok');
          }
        } else if (sql.startsWith('UPDATE domain_state')) {
          this.domainMutationCount += 1;
        } else if (sql.startsWith('UPDATE sync_scope_revision')) {
          const next = Number(statement.args[0]);
          const scopeKey = String(statement.args[1]);
          const base = Number(statement.args[2]);
          if ((this.revisions.get(scopeKey) ?? 0) === base) {
            this.revisions.set(scopeKey, next);
          }
        } else if (sql.startsWith('INSERT INTO sync_request')) {
          const requestId = String(statement.args[0]);
          if (this.requests.has(requestId)) throw new Error('UNIQUE constraint failed');
          this.requests.set(requestId, {
            scopeKey: String(statement.args[1]),
            baseRevision: Number(statement.args[2]),
            fingerprint: String(statement.args[3]),
            revision: Number(statement.args[4]),
          });
        } else if (sql.startsWith('DELETE FROM sync_request')) {
          const scopeKey = String(statement.args[0]);
          const cutoff = Number(statement.args[1]);
          for (const [requestId, request] of this.requests) {
            if (request.scopeKey === scopeKey && request.revision <= cutoff) {
              this.requests.delete(requestId);
            }
          }
        }
      }
    } catch (error) {
      this.revisions.clear();
      revisionBackup.forEach((value, key) => this.revisions.set(key, value));
      this.requests.clear();
      requestBackup.forEach((value, key) => this.requests.set(key, value));
      this.domainMutationCount = mutationBackup;
      throw error;
    }

    return statements.map(() => ({ success: true, results: [], meta: {} }));
  }

  run(statement: FakeStatement): void {
    const sql = statement.sql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('INSERT OR IGNORE INTO sync_scope_revision')) {
      const scopeKey = String(statement.args[0]);
      if (!this.revisions.has(scopeKey)) this.revisions.set(scopeKey, 0);
    }
  }

  first(statement: FakeStatement): unknown {
    const sql = statement.sql.replace(/\s+/g, ' ').trim();
    if (
      sql.startsWith('INSERT INTO sync_scope_revision')
      && sql.includes('RETURNING revision')
    ) {
      const scopeKey = String(statement.args[0]);
      const revision = (this.revisions.get(scopeKey) ?? 0) + 1;
      this.revisions.set(scopeKey, revision);
      return { revision };
    }
    if (sql.includes('FROM sync_request')) {
      const requestId = String(statement.args[0]);
      const request = this.requests.get(requestId);
      return request
        ? {
            scope_key: request.scopeKey,
            base_server_revision: request.baseRevision,
            payload_fingerprint: request.fingerprint,
            response_revision: request.revision,
          }
        : null;
    }
    if (sql.includes('FROM sync_scope_revision')) {
      const scopeKey = String(statement.args[0]);
      const revision = this.revisions.get(scopeKey);
      return revision === undefined ? null : { revision };
    }
    return null;
  }
}

function envelope(scopeKey = 'program:1', value = 1) {
  return {
    requestId: 'request-0001',
    scopeKey,
    baseServerRevision: 0,
    snapshot: { value },
  };
}

describe('validateSyncEnvelopeMetadata', () => {
  it('rejects invalid request and scope identifiers before persistence', () => {
    expect(() => validateSyncEnvelopeMetadata({
      requestId: 'x',
      scopeKey: 'program:1',
      baseServerRevision: 0,
    })).toThrow('SYNC_REQUEST_ID_INVALID');

    expect(() => validateSyncEnvelopeMetadata({
      requestId: 'request-0001',
      scopeKey: 'bad scope',
      baseServerRevision: 0,
    })).toThrow('SYNC_SCOPE_KEY_INVALID');
  });
});

describe('applySyncBatch', () => {
  it('applies domain statements and revision update atomically', async () => {
    const fake = new FakeDb();
    const db = fake as unknown as D1Database;
    const domainStatement = db.prepare('UPDATE domain_state SET value = 1');

    await expect(applySyncBatch(db, envelope(), [domainStatement])).resolves.toEqual({
      kind: 'accepted',
      serverRevision: 1,
    });

    expect(fake.domainMutationCount).toBe(1);
    expect(fake.revisions.get('program:1')).toBe(1);
    expect(fake.requests.get('request-0001')).toMatchObject({
      scopeKey: 'program:1',
      baseRevision: 0,
      revision: 1,
    });
    expect(fake.requests.get('request-0001')?.fingerprint).toHaveLength(64);
  });

  it('returns the original result for an idempotent retry without applying the domain twice', async () => {
    const fake = new FakeDb();
    const db = fake as unknown as D1Database;
    const domainStatement = db.prepare('UPDATE domain_state SET value = 1');

    await applySyncBatch(db, envelope(), [domainStatement]);
    await expect(applySyncBatch(db, envelope(), [domainStatement])).resolves.toEqual({
      kind: 'accepted',
      serverRevision: 1,
    });

    expect(fake.domainMutationCount).toBe(1);
  });

  it('rejects a stale base revision before executing domain statements', async () => {
    const fake = new FakeDb();
    fake.revisions.set('program:1', 3);
    const db = fake as unknown as D1Database;
    const domainStatement = db.prepare('UPDATE domain_state SET value = 1');

    await expect(applySyncBatch(db, envelope(), [domainStatement])).resolves.toEqual({
      kind: 'conflict',
      serverRevision: 3,
    });

    expect(fake.domainMutationCount).toBe(0);
  });

  it('detects a CAS race that happens after the initial revision read', async () => {
    const fake = new FakeDb();
    fake.raceRevisionOnBatch = 2;
    const db = fake as unknown as D1Database;
    const domainStatement = db.prepare('UPDATE domain_state SET value = 1');

    await expect(applySyncBatch(db, envelope(), [domainStatement])).resolves.toEqual({
      kind: 'conflict',
      serverRevision: 2,
    });

    expect(fake.domainMutationCount).toBe(0);
  });

  it('rejects reuse of a request id when the base revision or snapshot changed', async () => {
    const fake = new FakeDb();
    const db = fake as unknown as D1Database;

    await applySyncBatch(db, envelope(), []);

    await expect(applySyncBatch(db, {
      ...envelope(),
      snapshot: { value: 2 },
    }, [])).rejects.toBeInstanceOf(SyncRequestReuseError);

    await expect(applySyncBatch(db, {
      ...envelope(),
      baseServerRevision: 1,
    }, [])).rejects.toBeInstanceOf(SyncRequestReuseError);
  });

  it('keeps only a bounded revision window of idempotency records', async () => {
    const fake = new FakeDb();
    const db = fake as unknown as D1Database;
    const total = SYNC_REQUEST_RETENTION_REVISIONS + 2;

    for (let index = 0; index < total; index += 1) {
      await applySyncBatch(db, {
        requestId: `request-${String(index).padStart(4, '0')}`,
        scopeKey: 'program:1',
        baseServerRevision: index,
        snapshot: { value: index },
      }, []);
    }

    expect(fake.requests.size).toBe(SYNC_REQUEST_RETENTION_REVISIONS);
    expect(fake.requests.has('request-0000')).toBe(false);
    expect(fake.requests.has('request-0001')).toBe(false);

    await expect(applySyncBatch(db, {
      requestId: 'request-0000',
      scopeKey: 'program:1',
      baseServerRevision: 0,
      snapshot: { value: 0 },
    }, [])).resolves.toEqual({
      kind: 'conflict',
      serverRevision: total,
    });
  });

  it('bumps and returns the scope revision in one statement', async () => {
    const fake = new FakeDb();
    const db = fake as unknown as D1Database;

    await expect(bumpSyncScopeRevision(db, 'program:1')).resolves.toBe(1);
    await expect(bumpSyncScopeRevision(db, 'program:1')).resolves.toBe(2);
    expect(fake.revisions.get('program:1')).toBe(2);
  });

  it('does not allow one request id to be reused for another scope', async () => {
    const fake = new FakeDb();
    const db = fake as unknown as D1Database;

    await applySyncBatch(db, envelope('program:1'), []);

    await expect(
      applySyncBatch(db, {
        ...envelope('program:2'),
        baseServerRevision: 0,
      }, []),
    ).rejects.toBeInstanceOf(SyncRequestReuseError);
  });
});
