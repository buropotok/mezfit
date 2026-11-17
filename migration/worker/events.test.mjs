import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeUploads, parseUploadEvent } from './events';

const id = 'a9292ed7-b383-45ad-aa27-665cd70f91a2';
const account = 'a'.repeat(32);
const object = { key: 'smoke/' + id, size: 23, eTag: 'c2c4344304438b96fbd9a2383b658334' };
// Fields come from the Cloudflare R2 Event Notifications message format.
const event = { account, action: 'PutObject', bucket: 'mezfit-migration-uploads', object,
  eventTime: '2026-11-17T00:00:00.123Z' };
const head = { size: object.size, etag: object.eTag, httpMetadata: { contentType: 'application/octet-stream' } };
const databases = [];

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  for (const file of ['0001_create_migration_jobs.sql', '0002_create_migration_smoke_replays.sql']) {
    sqlite.exec(readFileSync(new URL('../d1/' + file, import.meta.url), 'utf8'));
  }
  const database = {
    prepare: sql => ({ bind: (...args) => ({ run: () => {
      sqlite.prepare(sql).run(...args);
      return { success: true };
    } }) }),
    batch: vi.fn(async statements => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }),
  };
  const env = { CLOUDFLARE_ACCOUNT_ID: account, JOBS: database, UPLOADS: { head: vi.fn(async () => head) } };
  return { sqlite, env, database };
}

async function deliver(env, body = event) {
  const message = { body, ack: vi.fn(), retry: vi.fn() };
  await consumeUploads({ messages: [message] }, env);
  return message;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

describe('migration R2 notification consumer', () => {
  it('validates the R2 envelope and accepts the same ETag quoted or unquoted', () => {
    expect(parseUploadEvent(event, account)).toEqual(event);
    expect(parseUploadEvent({ ...event, object: { ...object, eTag: '"' + object.eTag.toUpperCase() + '"' } }, account)).toEqual(event);
    for (const value of [{ ...event, account: 'wrong' }, { ...event, bucket: 'wrong' },
      { ...event, action: 'DeleteObject' }, { ...event, eventTime: 'wrong' },
      { ...event, object: { ...object, key: '../wrong' } }, { ...event, object: { ...object, size: -1 } },
      { ...event, object: { ...object, eTag: 'invalid' } }, { ...event, smokeReplay: 'wrong' }]) {
      expect(parseUploadEvent(value, account)).toBeNull();
    }
  });

  it('writes one technical job and one exact replay receipt, preserving job identity and state', async () => {
    const { env, sqlite } = setup();
    const job = () => sqlite.prepare('SELECT * FROM migration_jobs').get();
    const replay = () => sqlite.prepare('SELECT * FROM migration_smoke_replays').all();
    expect((await deliver(env, { ...event, smokeReplay: id })).ack).toHaveBeenCalledOnce();
    expect(job()).toBeUndefined(); // a replay alone cannot create the original
    expect((await deliver(env)).ack).toHaveBeenCalledOnce();
    const initial = job();
    expect(initial).toMatchObject({ id: object.key, state: 'uploaded', deliveries: 1 });
    await deliver(env);
    expect(replay()).toHaveLength(0);
    await deliver(env, { ...event, smokeReplay: id });
    await deliver(env, { ...event, smokeReplay: id });
    expect(sqlite.prepare('SELECT COUNT(*) AS total FROM migration_jobs').get().total).toBe(1);
    expect(job()).toEqual({ ...initial, deliveries: 4 });
    expect(replay()).toHaveLength(1);
    expect(replay()[0]).toMatchObject({ replay_id: id, object_key: object.key });
  });

  it('records absent and mismatching objects and recovers a rejected row on a verified event', async () => {
    const { env, sqlite } = setup();
    const job = () => sqlite.prepare('SELECT state, error_code FROM migration_jobs').get();
    env.UPLOADS.head.mockResolvedValueOnce(null);
    expect((await deliver(env)).ack).toHaveBeenCalledOnce();
    expect(job()).toEqual({ state: 'rejected', error_code: 'OBJECT_MISSING' });
    await deliver(env);
    expect(job()).toEqual({ state: 'uploaded', error_code: null });
    env.UPLOADS.head.mockResolvedValueOnce({ ...head, size: object.size + 1 });
    await deliver(env);
    expect(job()).toEqual({ state: 'uploaded', error_code: null });
    sqlite.exec('DELETE FROM migration_jobs');
    env.UPLOADS.head.mockResolvedValueOnce({ ...head, size: object.size + 1 });
    await deliver(env);
    expect(job()).toEqual({ state: 'rejected', error_code: 'OBJECT_MISMATCH' });
  });

  it('acks invalid notifications and retries transient R2 and D1 errors without false acks', async () => {
    const { env, database } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await deliver(env, { ...event, bucket: 'wrong' })).ack).toHaveBeenCalledOnce();
    expect(env.UPLOADS.head).not.toHaveBeenCalled();
    env.UPLOADS.head.mockRejectedValueOnce(new Error('R2 unavailable'));
    database.batch.mockRejectedValueOnce(new Error('D1 unavailable'));
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = await deliver(env);
      expect(message.ack).not.toHaveBeenCalled();
      expect(message.retry).toHaveBeenCalledOnce();
    }
    expect((await deliver(env)).ack).toHaveBeenCalledOnce();
  });
});
