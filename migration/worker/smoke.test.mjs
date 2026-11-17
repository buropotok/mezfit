import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signBackupPut, UPLOAD_BUCKET, UPLOAD_TTL_SECONDS } from './r2-upload';
import { anonymousRejected, expiryRejected, readS3Reply, signatureRejected, writeOnceRejected } from './smoke-http';
import { runMigrationSmoke } from './smoke';

const id = 'a9292ed7-b383-45ad-aa27-665cd70f91a2';
const key = 'smoke/' + id;
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), MIGRATION_R2_ACCESS_KEY_ID: 'b'.repeat(32),
  MIGRATION_R2_SECRET_ACCESS_KEY: 'c'.repeat(64) };
const body = 'mezfit-migration-smoke\n';
const metadata = { sizeBytes: Buffer.byteLength(body), contentType: 'application/octet-stream' };
const etag = createHash('md5').update(body).digest('hex');

function s3(status, code, message = '') {
  return new Response('<Error><Code>' + code + '</Code><Message>' + message + '</Message></Error>', { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('migration R2 SigV4 and S3 replies', () => {
  it('matches an independent AWS SigV4 calculation and binds byte length, MIME and If-None-Match', async () => {
    // AWS SigV4 query signing canonical format. The independent implementation uses Node crypto.
    const now = new Date('2026-11-17T00:00:00.123Z');
    const { putUrl, expiresAt } = await signBackupPut(key, metadata, env, now);
    const url = new URL(putUrl);
    expect(url.hostname).toBe(UPLOAD_BUCKET + '.' + env.CLOUDFLARE_ACCOUNT_ID + '.r2.cloudflarestorage.com');
    const actual = url.searchParams.get('X-Amz-Signature');
    const query = url.search.slice(1).split('&').filter(item => !item.startsWith('X-Amz-Signature=')).sort().join('&');
    const headers = 'content-length;content-type;host;if-none-match';
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(headers);
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_TTL_SECONDS));
    expect(expiresAt).toBe(Date.parse('2026-11-17T00:10:00.000Z'));
    const canonical = ['PUT', '/' + key, query, 'content-length:' + metadata.sizeBytes, 'content-type:' + metadata.contentType,
      'host:' + url.host, 'if-none-match:*', '', headers, 'UNSIGNED-PAYLOAD'].join('\n');
    const digest = createHash('sha256').update(canonical).digest('hex');
    const signingKey = ['20261117', 'auto', 's3', 'aws4_request'].reduce((value, part) =>
      createHmac('sha256', value).update(part).digest(), Buffer.from('AWS4' + env.MIGRATION_R2_SECRET_ACCESS_KEY));
    const expected = createHmac('sha256', signingKey)
      .update(['AWS4-HMAC-SHA256', '20261117T000000Z', '20261117/auto/s3/aws4_request', digest].join('\n')).digest('hex');
    expect(actual).toBe(expected);
  });

  it('requires the S3 error semantics and does not accept generic HTTP 400/403/412', async () => {
    expect(signatureRejected(await readS3Reply(s3(403, 'SignatureDoesNotMatch')))).toBe(true);
    expect(signatureRejected(await readS3Reply(s3(403, 'AccessDenied')))).toBe(false);
    expect(signatureRejected(await readS3Reply(s3(400, 'InvalidArgument', 'Missing signed header if-none-match')), true)).toBe(true);
    expect(signatureRejected(await readS3Reply(s3(400, 'InvalidArgument', 'Unrelated')), true)).toBe(false);
    expect(expiryRejected(await readS3Reply(s3(403, 'AccessDenied', 'Request has expired')))).toBe(true);
    expect(expiryRejected(await readS3Reply(s3(403, 'AccessDenied')))).toBe(false);
    expect(writeOnceRejected(await readS3Reply(s3(412, 'PreconditionFailed')))).toBe(true);
    expect(writeOnceRejected(await readS3Reply(s3(412, 'AccessDenied')))).toBe(false);
    expect(anonymousRejected(await readS3Reply(s3(401, 'Unauthorized')))).toBe(true);
    expect(anonymousRejected(await readS3Reply(s3(404, 'NoSuchKey')))).toBe(false);
  });
});

function smokeFixture({ loseReply = false, badMime = false } = {}) {
  const objects = new Map();
  const swept = 'smoke/ba318b65-dcb8-4831-8300-3813b2edd693';
  const userKey = 'uploads/' + id;
  const stored = { size: metadata.sizeBytes, etag, httpMetadata: { contentType: metadata.contentType } };
  objects.set(swept, stored);
  objects.set(userKey, stored);
  let uploaded = 0;
  let replay = false;
  const job = { id: key, state: 'uploaded', object_etag: etag, object_size: metadata.sizeBytes,
    content_type: metadata.contentType, event_at: '2026-11-17T00:00:00.000Z', event_action: 'PutObject', error_code: null };
  const deps = { ...env,
    UPLOADS: {
      list: async () => ({ truncated: false, objects: [...objects.keys()].map(key => ({ key, uploaded: new Date(0) })) }),
      head: async key => objects.get(key) ?? null,
      delete: async keys => keys.forEach(key => objects.delete(key)),
    },
    JOBS: { prepare: sql => ({ bind: () => ({ first: async () =>
      sql.includes('migration_smoke_replays') ? replay ? { object_key: key } : null : job }) }) },
    EVENTS: { send: vi.fn(async event => { replay = event.smokeReplay === id; }) },
  };
  vi.stubGlobal('fetch', vi.fn(async (input, options) => {
    const path = new URL(input).pathname.slice(1);
    if (options.method === 'GET') return s3(401, 'Unauthorized');
    expect(options.body).toBeInstanceOf(Uint8Array);
    expect(options.headers).not.toHaveProperty('Content-Length');
    expect(options.redirect).toBe('manual');
    if (path !== key) {
      if (path.endsWith('/expired')) return s3(403, 'AccessDenied', 'Request has expired');
      if (badMime && path.endsWith('/mime')) {
        objects.set(path, stored);
        return new Response(null, { status: 200 });
      }
      return s3(403, 'SignatureDoesNotMatch');
    }
    if (objects.has(path)) return s3(412, 'PreconditionFailed');
    objects.set(path, stored);
    uploaded++;
    if (loseReply) throw new Error('transport interrupted after commit');
    return new Response(null, { status: 200 });
  }));
  const executed = [];
  const step = { do: async (name, options, run) => {
    for (let retries = 0; ; retries++) {
      executed.push(name);
      try { return await run(); }
      catch (error) {
        if (!error.retryable || retries >= options.retries.limit) throw error;
      }
    }
  } };
  return { deps, step, executed, objects, swept, userKey, writes: () => uploaded };
}

describe('migration Workflow smoke operations', () => {
  it('reconciles an upload committed before a lost reply, verifies replay, and cleans only smoke objects', async () => {
    const fixture = smokeFixture({ loseReply: true });
    await expect(runMigrationSmoke(fixture.deps, id, fixture.step, message => new Error(message))).resolves.toBe('MIGRATION_SMOKE_OK');
    expect(fixture.writes()).toBe(1);
    expect(fixture.deps.EVENTS.send).toHaveBeenCalledOnce();
    expect(fixture.deps.EVENTS.send.mock.calls[0][0]).toMatchObject({ smokeReplay: id, object: { key, eTag: etag } });
    expect([...fixture.objects.keys()]).toEqual([fixture.userKey]);
  });

  it('does not retry a rejected protocol contract and removes an unexpected negative-probe object', async () => {
    const fixture = smokeFixture({ badMime: true });
    await expect(runMigrationSmoke(fixture.deps, id, fixture.step, message => new Error(message))).rejects.toThrow('SMOKE_BAD_PUT_CREATED_OBJECT');
    expect(fixture.executed.filter(step => step === 'Reject signed PUT mime')).toHaveLength(1);
    expect([...fixture.objects.keys()]).toEqual([fixture.userKey]);
  });
});
