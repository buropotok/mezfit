import { describe, expect, it, vi } from 'vitest';
import logging from '../infra/yandex-media-mvp/function/media-log.js';

const env = {
  MEDIA_LOG_BUCKET: 'mezfit-private-logs',
  MEDIA_LOG_S3_ACCESS_KEY_ID: 'logAccess',
  MEDIA_LOG_S3_SECRET_ACCESS_KEY: 'logSecret',
};

function fakeStorage({ prefill = {}, conflictOnce = false } = {}) {
  const objects = new Map(Object.entries(prefill).map(([key, body]) => [key, Buffer.from(body)]));
  let conflicts = conflictOnce ? 1 : 0;
  const calls = [];
  const etag = data => '"' + data.length.toString(16) + '-' + data.toString('hex').slice(0, 16) + '"';
  const fetchImpl = vi.fn(async (url, init) => {
    const parsed = new URL(url);
    const method = init.method;
    const key = parsed.pathname.replace('/' + env.MEDIA_LOG_BUCKET + '/', '');
    calls.push({ method, key, headers: init.headers });
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=logAccess\//);
    expect(init.headers.authorization).not.toContain(env.MEDIA_LOG_S3_SECRET_ACCESS_KEY);
    if (method === 'GET') {
      const prefix = parsed.searchParams.get('prefix') ?? '';
      const items = [...objects].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b));
      const xml = '<ListBucketResult><IsTruncated>false</IsTruncated>'
        + items.map(([name, data]) => '<Contents><Key>' + name + '</Key><Size>' + data.length
          + '</Size></Contents>').join('') + '</ListBucketResult>';
      return new Response(xml);
    }
    if (method === 'HEAD') {
      const data = objects.get(key);
      return data ? new Response(null, {
        status: 200, headers: { etag: etag(data), 'content-length': String(data.length) },
      }) : new Response(null, { status: 404 });
    }
    if (method === 'PUT') {
      if (objects.has(key)) return new Response(null, { status: 412 });
      expect(init.headers['if-none-match']).toBe('*');
      objects.set(key, Buffer.from(init.body));
      return new Response(null, { status: 200 });
    }
    if (method === 'PATCH') {
      const previous = objects.get(key);
      if (!previous) return new Response(null, { status: 404 });
      if (conflicts-- > 0) {
        objects.set(key, Buffer.concat([previous, Buffer.from('{"other":"writer"}\n')]));
        return new Response(null, { status: 412 });
      }
      if (init.headers['if-match'] !== etag(previous)) return new Response(null, { status: 412 });
      const data = Buffer.from(init.body);
      expect(init.headers['content-range']).toBe(
        'bytes ' + previous.length + '-' + (previous.length + data.length - 1) + '/*',
      );
      objects.set(key, Buffer.concat([previous, data]));
      return new Response('<PatchObjectResult/>', { status: 200 });
    }
    throw new Error('Unexpected method: ' + method);
  });
  return { objects, calls, fetchImpl };
}

const event = (name = 'SIGNATURE_CREATED') => ({
  timestamp: '2026-11-15T12:00:00.000Z', requestId: 'req-123', tgId: '123',
  event: name, level: 'INFO',
});

describe('Yandex media diagnostic log storage', () => {
  it('creates the first Moscow-day file, then appends with conditional PATCH', async () => {
    const storage = fakeStorage();
    const now = new Date('2026-11-15T12:00:00Z');
    const first = await logging.appendEvents([event()], env, { now, fetchImpl: storage.fetchImpl });
    const next = await logging.appendEvents([event('RESPONSE_CREATED')], env, { now, fetchImpl: storage.fetchImpl });
    expect(first).toBe('logs_20261115_0001');
    expect(next).toBe(first);
    expect(storage.calls.map(call => call.method)).toEqual(['GET', 'PUT', 'GET', 'HEAD', 'PATCH']);
    expect(storage.objects.get(first).toString('utf8').trim().split('\n')).toHaveLength(2);
  });

  it('starts a new file whenever the Moscow date changes, even below 1 MiB', async () => {
    const storage = fakeStorage();
    await logging.appendEvents([event()], env, {
      now: new Date('2026-11-15T20:59:00Z'), fetchImpl: storage.fetchImpl,
    });
    await logging.appendEvents([event()], env, {
      now: new Date('2026-11-15T21:01:00Z'), fetchImpl: storage.fetchImpl,
    });
    expect([...storage.objects.keys()]).toEqual(['logs_20261115_0001', 'logs_20261116_0001']);
  });

  it('rolls to the next sequence once the latest object exceeds 1 MiB', async () => {
    const old = Buffer.alloc(logging.LIMIT_BYTES + 1, 0x61);
    const storage = fakeStorage({ prefill: { logs_20261115_0001: old } });
    const key = await logging.appendEvents([event()], env, {
      now: new Date('2026-11-15T12:00:00Z'), fetchImpl: storage.fetchImpl,
    });
    expect(key).toBe('logs_20261115_0002');
    expect(storage.objects.get('logs_20261115_0001')).toEqual(old);
    expect(storage.calls.map(call => call.method)).toEqual(['GET', 'PUT']);
  });

  it('retries on an ETag conflict without overwriting another writer', async () => {
    const storage = fakeStorage({ prefill: { logs_20261115_0001: '{"before":true}\n' }, conflictOnce: true });
    const key = await logging.appendEvents([event()], env, {
      now: new Date('2026-11-15T12:00:00Z'), fetchImpl: storage.fetchImpl,
    });
    const data = storage.objects.get(key).toString('utf8');
    expect(storage.calls.filter(call => call.method === 'PATCH')).toHaveLength(2);
    expect(data).toContain('"other":"writer"');
    expect(data.match(/"SIGNATURE_CREATED"/g)).toHaveLength(1);
  });

  it('does not try writing without a separately configured private bucket and credentials', async () => {
    const storage = fakeStorage();
    await expect(logging.appendEvents([event()], { MEDIA_LOG_BUCKET: env.MEDIA_LOG_BUCKET }, {
      fetchImpl: storage.fetchImpl,
    })).rejects.toThrow('LOG_CONFIG_INVALID');
    expect(storage.fetchImpl).not.toHaveBeenCalled();
  });

  it('records only allowlisted safe fields and never raw Telegram initData', () => {
    const recorder = logging.createRecorder(() => new Date('2026-11-15T12:00:00Z'));
    recorder.record('REQUEST_RECEIVED', 'INFO', {
      origin: 'https://mezfit.example', initData: 'secret', authorization: 'secret',
    });
    recorder.record('TELEGRAM_AUTH_VALID', 'INFO', { tgId: '123456' });
    recorder.record('SIGNATURE_CREATED', 'INFO', { putUrl: 'https://secret', fileBody: 'secret' });
    expect(recorder.events[0].tgId).toBeNull();
    expect(recorder.events[1].tgId).toBe('123456');
    expect(recorder.events[2].tgId).toBe('123456');
    expect(JSON.stringify(recorder.events)).not.toContain('secret');
    expect(recorder.events[0].origin).toBe('https://mezfit.example');
  });
});
