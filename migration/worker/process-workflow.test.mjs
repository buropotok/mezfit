import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, processorInstanceId, processorResultKey } from '../processor-protocol.mjs';
import { consumeUploads } from './events';
import { runProcess } from './process-workflow';
import { cleanupProcessorSmoke } from './processor-smoke';

const id = '4fe7581a-62c8-407d-bae6-6ddfe8067036';
const key = 'uploads/' + id;
const resultKey = processorResultKey(id);
const instance = processorInstanceId(id);
const context = { trace_id: id, instance_id: instance, job_id: id, processor_version: 'v1' };
const account = 'a'.repeat(32);
const mime = 'application/octet-stream';
const fixture = JSON.stringify({ format: FIXTURE_FORMAT, records: [{ value: 9 }] });
const databases = [];

function setup(value = fixture) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  for (const migration of ['0001_create_migration_jobs', '0002_create_migration_smoke_replays', '0003_create_migration_executions']) {
    sqlite.exec(readFileSync(new URL('../d1/' + migration + '.sql', import.meta.url), 'utf8'));
  }
  const updates = vi.fn(() => {});
  const prepare = sql => ({
    bind: (...args) => ({
      first: () => sqlite.prepare(sql).get(...args) ?? null,
      run: () => {
        updates(sql, args[0]);
        if (/^\s*SELECT\b/i.test(sql)) return { success: true, results: sqlite.prepare(sql).all(...args), meta: { changes: 0 } };
        return { success: true, results: [], meta: sqlite.prepare(sql).run(...args) };
      },
    }),
  });
  const batch = statements => {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  };
  const bytes = new TextEncoder().encode(value);
  const etag = createHash('md5').update(bytes).digest('hex');
  const metadata = { etag, httpEtag: '"' + etag + '"', size: bytes.byteLength, httpMetadata: { contentType: mime } };
  const objects = new Map([[key, { bytes: bytes.buffer, metadata }]]);
  const env = { CLOUDFLARE_ACCOUNT_ID: account, JOBS: { prepare, batch },
    MIGRATION_WORKFLOW: { create: vi.fn(async () => ({ id: instance })), get: vi.fn(async () => ({ status: async () => ({ status: 'running' }) })) },
    UPLOADS: {
      head: vi.fn(async path => {
        const metadata = objects.get(path)?.metadata;
        return metadata ? { ...metadata } : null;
      }),
      delete: vi.fn(async path => { objects.delete(path); }),
      list: vi.fn(async ({ prefix, limit }) => {
        const matching = [...objects.keys()].filter(path => path.startsWith(prefix));
        return { objects: matching.slice(0, limit).map(key => ({ key })), truncated: matching.length > limit };
      }),
      get: vi.fn(async path => {
        const object = objects.get(path);
        return object ? { ...object.metadata, body: new ReadableStream(), arrayBuffer: async () => object.bytes } : null;
      }),
      put: vi.fn(async (path, data, options) => {
        if (path !== resultKey) return {};
        if (options.onlyIf.get('If-None-Match') !== '*' || objects.has(path)) return null;
        const etag = createHash('md5').update(data).digest('hex');
        objects.set(path, { bytes: data.buffer, metadata: { size: data.byteLength, httpMetadata: options.httpMetadata,
          etag, httpEtag: '"' + etag + '"', version: 'result-version' } });
        return {};
      }),
    },
  };
  const event = { account, action: 'PutObject', bucket: 'mezfit-migration-uploads',
    object: { key, eTag: etag, size: bytes.byteLength }, eventTime: '2026-11-17T00:00:00.123Z' };
  const step = { do: vi.fn(async (_name, policy, action) => {
    for (let attempt = 1; ; attempt++) {
      try { return await action({ attempt }); }
      catch (error) { if (error.name === 'NonRetryableError' || attempt > policy.retries.limit) throw error; }
    }
  }) };
  const deliver = async (body = event) => {
    const message = { body, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await consumeUploads({ messages: [message] }, env);
    return message;
  };
  return { env, step, objects, event, deliver, updates, log, sqlite,
    execution: () => sqlite.prepare('SELECT * FROM migration_executions').get(),
    saved: () => objects.get(resultKey)?.bytes,
    run: (ready = true) => runProcess(env, step, id, context, ready),
  };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});

describe('migration processor workflow', () => {
  it('reuses a deterministic instance after an ambiguous creation and keeps the completed execution on replay', async () => {
    const job = setup();
    job.env.MIGRATION_WORKFLOW.create.mockRejectedValueOnce(new Error('transport failure'));
    expect((await job.deliver()).ack).toHaveBeenCalledOnce();
    expect(job.env.MIGRATION_WORKFLOW.get).toHaveBeenCalledWith(instance);
    await expect(job.run()).resolves.toBe(resultKey);
    const execution = job.execution();
    expect(execution).toMatchObject({ state: 'succeeded', attempts: 1, result_key: resultKey,
      result_sha256: createHash('sha256').update(new Uint8Array(job.saved())).digest('hex') });

    await job.deliver();
    await job.run();
    expect(job.env.MIGRATION_WORKFLOW.create).toHaveBeenCalledOnce();
    expect(job.execution()).toEqual(execution);
    expect(job.env.UPLOADS.put.mock.calls.filter(([key]) => key === resultKey)).toHaveLength(1);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'RESULT_CHECKSUM_VERIFIED', status: 'OK' }));
  });

  it('retries the original Queue message if creation and readback are both unconfirmed', async () => {
    const job = setup();
    job.env.MIGRATION_WORKFLOW.create.mockRejectedValueOnce(new Error('transport failure'));
    job.env.MIGRATION_WORKFLOW.get.mockRejectedValueOnce(new Error('not found'));
    expect((await job.deliver()).retry).toHaveBeenCalledOnce();
    expect(job.execution().state).toBe('queued');
    expect((await job.deliver()).ack).toHaveBeenCalledOnce();
    expect(job.env.MIGRATION_WORKFLOW.create.mock.calls.map(([input]) => input.id)).toEqual([instance, instance]);
  });

  it('keeps result and trace notifications out of job registration', async () => {
    const job = setup();
    for (const objectKey of [resultKey, '_migration-traces/' + id + '/' + id + '.json']) {
      expect((await job.deliver({ ...job.event, object: { ...job.event.object, key: objectKey } })).ack).toHaveBeenCalledOnce();
    }
    expect(job.execution()).toBeUndefined();
    expect(job.env.UPLOADS.head).not.toHaveBeenCalled();
  });

  it.each([
    ['missing input', 'INPUT_MISSING', job => job.objects.delete(key)],
    ['ETag mismatch', 'INPUT_ETAG_MISMATCH', job => { job.objects.get(key).metadata.etag = 'c'.repeat(32); }],
    ['old Worker version', 'DEPLOYED_VERSION_NOT_READY', () => {}],
  ])('records a permanent failure for %s', async (scenario, code, alter) => {
    const job = setup();
    await job.deliver();
    alter(job);
    await expect(job.run(scenario !== 'old Worker version')).resolves.toBe('failed');
    expect(job.execution()).toMatchObject({ state: 'failed', error_code: code, attempts: 1 });
    expect(job.env.UPLOADS.get).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'PROCESS_INPUT_REJECTED', error_code: code }));
  });

  it.each([
    ['{', 'failed', 'INVALID_INPUT_JSON'],
    [' '.repeat(PROCESSOR_INPUT_LIMIT + 1), 'failed', 'PROCESSOR_INPUT_LIMIT'],
    ['binary', 'unsupported', 'UNSUPPORTED_FORMAT'],
  ])('keeps input failure separate from unsupported format', async (fixture, state, code) => {
    const job = setup(fixture);
    await job.deliver();
    expect(await job.run()).toBe(state);
    expect(job.execution()).toMatchObject({ state, error_code: code });
    expect(job.saved()).toBeUndefined();
  });

  it('rejects an empty upload during the existing registration path', async () => {
    const job = setup('');
    expect((await job.deliver()).ack).toHaveBeenCalledOnce();
    expect(job.execution()).toBeUndefined();
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'QUEUE_OBJECT_METADATA_COMPARED',
      error_code: 'INVALID_BACKUP_METADATA' }));
  });

  it('recovers a lost R2 PUT response and a D1 error after successful persistence', async () => {
    const job = setup();
    const put = job.env.UPLOADS.put.getMockImplementation();
    job.env.UPLOADS.put.mockImplementation(async (...args) => {
      const saved = await put(...args);
      if (args[0] === resultKey) throw new Error('response lost');
      return saved;
    });
    let writeError = true;
    job.updates.mockImplementation((sql, state) => {
      if (writeError && sql.startsWith('UPDATE migration_executions') && state === 'succeeded') {
        writeError = false;
        throw new Error('D1 unavailable');
      }
    });
    await job.deliver();
    expect(await job.run()).toBe(resultKey);
    expect(job.execution().state).toBe('succeeded');
    expect(job.env.UPLOADS.put.mock.calls.filter(([key]) => key === resultKey)).toHaveLength(1);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'WORKFLOW_STEP_RETRY', status: 'RETRY' }));
  });

  it('retries failed R2 PUT and readback before finalizing', async () => {
    const job = setup();
    const put = job.env.UPLOADS.put.getMockImplementation();
    const get = job.env.UPLOADS.get.getMockImplementation();
    let puts = 0;
    let reads = 0;
    job.env.UPLOADS.put.mockImplementation(async (...args) => {
      if (args[0] === resultKey && ++puts === 1) throw new Error('R2 unavailable');
      return put(...args);
    });
    job.env.UPLOADS.get.mockImplementation(async (...args) => {
      if (args[0] === resultKey && ++reads === 1) throw new Error('R2 unavailable');
      return get(...args);
    });
    await job.deliver();
    expect(await job.run()).toBe(resultKey);
    expect(job.execution().state).toBe('succeeded');
    expect([puts, reads]).toEqual([3, 2]);
  });

  it('rejects a conflicting result and preserves the existing bytes', async () => {
    const job = setup();
    const bytes = new TextEncoder().encode('foreign data').buffer;
    const etag = createHash('md5').update(new Uint8Array(bytes)).digest('hex');
    job.objects.set(resultKey, { bytes, metadata: { size: bytes.byteLength, httpMetadata: { contentType: 'application/json' },
      etag, httpEtag: '"' + etag + '"' } });
    await job.deliver();
    expect(await job.run()).toBe('failed');
    expect(job.execution()).toMatchObject({ state: 'failed', error_code: 'RESULT_CONFLICT' });
    expect(job.saved()).toBe(bytes);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'RESULT_CONFLICT_DETECTED', status: 'FAILED' }));

    job.objects.get(key).metadata.customMetadata = { processorSmoke: id };
    await expect(cleanupProcessorSmoke(job.env, id, job.step, context, code => new Error(code)))
      .rejects.toThrow('PROCESSOR_CLEANUP_RESULT_CONFLICT');
    expect(job.saved()).toBe(bytes);
  });

  it.each([['Worker exceeded CPU time limit', 'WORKFLOW_CPU_LIMIT'], ['Worker exceeded memory limit', 'WORKFLOW_MEMORY_LIMIT']])(
    'records platform resource failures using provider evidence', async (message, code) => {
      const job = setup();
      await job.deliver();
      job.env.UPLOADS.get.mockRejectedValue(new Error(message));
      expect(await job.run()).toBe('failed');
      expect(job.execution()).toMatchObject({ state: 'failed', error_code: code });
      expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'WORKFLOW_STEP', error_code: code, status: 'FAILED' }));
    });
});

function cleanupSetup(marker = id) {
  const job = setup();
  const { env, objects, sqlite, step } = job;
  Object.assign(objects.get(key).metadata, { customMetadata: { processorSmoke: marker }, version: 'fixture-version' });
  const rows = table => sqlite.prepare('SELECT * FROM ' + table).all();
  const complete = async () => {
    await job.deliver();
    await job.run();
    await job.deliver({ ...job.event, processorReplay: id });
  };
  const cleanup = () => cleanupProcessorSmoke(env, id, step, context,
    code => Object.assign(new Error(code), { name: 'NonRetryableError' }));
  return { ...job, rows, complete, cleanup };
}

const cleanupTables = ['migration_jobs', 'migration_executions', 'migration_smoke_replays'];
const cleanupOK = 'MIGRATION_PROCESSOR_CLEANUP_OK';

describe('processor smoke cleanup', () => {
  it('removes only the verified fixture, result and all three technical rows, then treats a retry as a no-op', async () => {
    const job = cleanupSetup();
    await job.complete();
    expect(cleanupTables.map(table => job.rows(table).length)).toEqual([1, 1, 1]);
    const unrelated = 'results/another-job/v1/result.json';
    job.objects.set(unrelated, job.objects.get(resultKey));
    await expect(job.cleanup()).resolves.toBe(cleanupOK);
    expect([...job.objects.keys()]).toEqual([unrelated]);
    expect(cleanupTables.flatMap(job.rows)).toEqual([]);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_SMOKE_CLEANUP', status: 'OK', actual: 'removed',
    }));
    job.env.UPLOADS.delete.mockClear();
    await expect(job.cleanup()).resolves.toBe(cleanupOK);
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_SCOPE', status: 'SKIPPED', actual: 'all-resources-absent',
    }));
  });

  it.each([resultKey, 'results/' + id + '/v2/result.json'])('preserves orphaned R2 content at %s', async path => {
    const job = cleanupSetup();
    const evidence = job.objects.get(key);
    job.objects.set(path, evidence);
    job.objects.delete(key);
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_INCOMPLETE');
    expect(job.objects.get(path)).toBe(evidence);
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_SCOPE', status: 'FAILED', actual: 'fixture-missing-with-residue',
    }));
  });

  it('preserves D1 rows when both R2 objects are absent', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.objects.clear();
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_INCOMPLETE');
    expect(cleanupTables.map(table => job.rows(table).length)).toEqual([1, 1, 1]);
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
  });

  it('preserves both objects when the saved result checksum differs from D1', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.sqlite.prepare('UPDATE migration_executions SET result_sha256 = ?').run('0'.repeat(64));
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_RESULT_CONFLICT');
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
    expect(cleanupTables.map(table => job.rows(table).length)).toEqual([1, 1, 1]);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_SCOPE', status: 'FAILED', error_code: 'PROCESSOR_CLEANUP_RESULT_CONFLICT',
    }));
  });

  it('rechecks ownership after a transient R2 delete and recovers after a transient verification error', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.env.UPLOADS.delete.mockRejectedValueOnce(new Error('private provider detail'));
    const head = job.env.UPLOADS.head.getMockImplementation();
    let readbackFailed = false;
    job.env.UPLOADS.head.mockImplementation(async path => {
      if (path === resultKey && !job.objects.has(resultKey) && !readbackFailed) {
        readbackFailed = true;
        throw new Error('private provider detail');
      }
      return head(path);
    });
    await expect(job.cleanup()).resolves.toBe(cleanupOK);
    expect(readbackFailed).toBe(true);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_R2_DELETE', status: 'FAILED', attempt: 1, duration_ms: expect.any(Number),
    }));
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_R2_READBACK', status: 'FAILED', attempt: 2, duration_ms: expect.any(Number),
    }));
    expect(JSON.stringify(job.log.mock.calls)).not.toContain('private provider detail');
  });

  it('preserves a result replaced after checksum verification', async () => {
    const job = cleanupSetup();
    await job.complete();
    const get = job.env.UPLOADS.get.getMockImplementation();
    job.env.UPLOADS.get.mockImplementation(async path => {
      const response = await get(path);
      if (path === resultKey) job.objects.get(path).metadata.version = 'replacement-version';
      return response;
    });
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_SCOPE_INVALID');
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
    expect(job.objects.get(resultKey).metadata.version).toBe('replacement-version');
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_R2_DELETE', status: 'FAILED', actual: 'object-changed',
    }));
  });

  it('keeps the fixture and D1 when removal of the verified result cannot be confirmed', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.env.UPLOADS.delete.mockResolvedValue(undefined);
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_R2_UNCONFIRMED');
    expect(job.objects.has(key)).toBe(true);
    expect(job.objects.has(resultKey)).toBe(true);
    expect(cleanupTables.map(table => job.rows(table).length)).toEqual([1, 1, 1]);
  });

  it('preserves D1 after a failed delete and refuses a later cleanup without the fixture', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.updates.mockImplementation(sql => {
      if (sql.startsWith('DELETE FROM migration_executions')) throw new Error('D1 unavailable');
    });
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_INCOMPLETE');
    expect(cleanupTables.map(table => job.rows(table).length)).toEqual([1, 1, 1]);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'PROCESSOR_CLEANUP_D1_DELETE', status: 'FAILED' }));
  });

  it('fails closed if D1 cannot confirm the final readback', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.updates.mockImplementation(sql => {
      if (sql.includes('FROM migration_smoke_replays WHERE') && sql.startsWith('SELECT') && !job.rows('migration_jobs').length) {
        throw new Error('D1 unavailable');
      }
    });
    await expect(job.cleanup()).rejects.toThrow();
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'PROCESSOR_CLEANUP_D1_READBACK', status: 'FAILED' }));
    expect(job.log).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'PROCESSOR_SMOKE_CLEANUP', status: 'OK' }));
  });

  it('reports the specific residual tables after a partially effective D1 delete', async () => {
    const job = cleanupSetup();
    await job.complete();
    job.sqlite.exec(`CREATE TRIGGER preserve_replay BEFORE DELETE ON migration_smoke_replays
      BEGIN SELECT RAISE(IGNORE); END`);
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_INCOMPLETE');
    expect(cleanupTables.map(table => job.rows(table).length)).toEqual([1, 0, 1]);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'PROCESSOR_CLEANUP_D1_TABLE', status: 'FAILED', details: { table: 'migration_smoke_replays', sql: 'SELECT' },
    }));
  });

  it.each(['queued', 'running'])('leaves an active %s execution and its fixture intact', async state => {
    const job = cleanupSetup();
    await job.deliver();
    job.sqlite.prepare('UPDATE migration_executions SET state = ?').run(state);
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_EXECUTION_ACTIVE');
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
    expect(job.execution().state).toBe(state);
  });

  it.each([undefined, 'wrong-owner'])('leaves input with ownership marker %s intact', async marker => {
    const job = cleanupSetup(marker);
    if (marker === undefined) delete job.objects.get(key).metadata.customMetadata;
    await expect(job.cleanup()).rejects.toThrow('PROCESSOR_CLEANUP_SCOPE_INVALID');
    expect(job.env.UPLOADS.delete).not.toHaveBeenCalled();
    expect(job.objects.has(key)).toBe(true);
  });
});
