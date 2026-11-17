import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_FORMAT, PROCESSOR_INPUT_LIMIT, processorInstanceId, processorResultKey } from '../processor-protocol.mjs';
import { consumeUploads } from './events';
import { runProcess } from './process-workflow';

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
      head: vi.fn(async path => objects.get(path)?.metadata ?? null),
      get: vi.fn(async path => {
        const object = objects.get(path);
        return object ? { ...object.metadata, body: new ReadableStream(), arrayBuffer: async () => object.bytes } : null;
      }),
      put: vi.fn(async (path, data, options) => {
        if (path !== resultKey) return {};
        if (options.onlyIf.get('If-None-Match') !== '*' || objects.has(path)) return null;
        objects.set(path, { bytes: data.buffer, metadata: { size: data.byteLength, httpMetadata: options.httpMetadata } });
        return {};
      }),
    },
  };
  const event = { account, action: 'PutObject', bucket: 'mezfit-migration-uploads',
    object: { key, eTag: etag, size: bytes.byteLength }, eventTime: '2026-11-17T00:00:00.123Z' };
  const step = { do: vi.fn(async (_name, policy, action) => {
    for (let attempt = 1; ; attempt++) {
      try { return await action({ attempt }); }
      catch (error) { if (attempt > policy.retries.limit) throw error; }
    }
  }) };
  const deliver = async (body = event) => {
    const message = { body, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await consumeUploads({ messages: [message] }, env);
    return message;
  };
  return { env, step, objects, event, deliver, updates, log,
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
      if (args[0] === resultKey && ++reads === 2) throw new Error('R2 unavailable');
      return get(...args);
    });
    await job.deliver();
    expect(await job.run()).toBe(resultKey);
    expect(job.execution().state).toBe('succeeded');
    expect([puts, reads]).toEqual([3, 3]);
  });

  it('rejects a conflicting result and preserves the existing bytes', async () => {
    const job = setup();
    const bytes = new TextEncoder().encode('foreign data').buffer;
    job.objects.set(resultKey, { bytes, metadata: { size: bytes.byteLength, httpMetadata: { contentType: 'application/json' } } });
    await job.deliver();
    expect(await job.run()).toBe('failed');
    expect(job.execution()).toMatchObject({ state: 'failed', error_code: 'RESULT_CONFLICT' });
    expect(job.saved()).toBe(bytes);
    expect(job.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'RESULT_CONFLICT_DETECTED', status: 'FAILED' }));
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
