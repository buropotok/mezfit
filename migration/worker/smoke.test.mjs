import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signBackupPut, signSmokeExpiryPut, SMOKE_EXPIRY_TTL_SECONDS, UPLOAD_BUCKET, UPLOAD_TTL_SECONDS } from './r2-upload';
import { anonymousRejected, expiryNeedsControl, expiryRejected, readS3Reply, signatureRejected, writeOnceRejected } from './smoke-http';
import { runMigrationSmoke } from './smoke';
import { consumeUploads } from './events';

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

function smokeFixture({ loseReply = false, badMime = false, expiredReply = () => s3(403, 'AccessDenied', 'Request has expired'),
  freshDenied = false, overwrite = () => s3(412, 'PreconditionFailed'), anonymous = () => s3(401, 'Unauthorized'),
  changeVersionOnOverwrite = false } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));
  const objects = new Map();
  const swept = 'smoke/ba318b65-dcb8-4831-8300-3813b2edd693';
  const userKey = 'uploads/' + id;
  const stored = { size: metadata.sizeBytes, etag, version: 'first-version', httpMetadata: { contentType: metadata.contentType } };
  const expiryRequests = [];
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
    const url = new URL(input);
    const path = url.pathname.slice(1);
    if (options.method === 'GET') {
      expect(url.search).toBe('');
      expect(options.headers).toBeUndefined();
      return anonymous();
    }
    expect(options.body).toBeInstanceOf(Uint8Array);
    expect(options.headers).not.toHaveProperty('Content-Length');
    expect(options.redirect).toBe('manual');
    if (path !== key) {
      if (path.endsWith('/expired')) {
        const ttl = Number(url.searchParams.get('X-Amz-Expires'));
        const date = url.searchParams.get('X-Amz-Date');
        const issued = Date.parse(date.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'));
        expiryRequests.push({ url: input, size: options.body.byteLength, headers: { ...options.headers } });
        if (Date.now() >= issued + ttl * 1000) return expiredReply();
        if (ttl === UPLOAD_TTL_SECONDS && freshDenied) return s3(403, 'AccessDenied');
        if (objects.has(path)) return s3(412, 'PreconditionFailed');
        objects.set(path, stored);
        return new Response(null, { status: 200 });
      }
      if (badMime && path.endsWith('/mime')) {
        objects.set(path, stored);
        return new Response(null, { status: 200 });
      }
      return s3(403, 'SignatureDoesNotMatch');
    }
    if (objects.has(path)) {
      if (changeVersionOnOverwrite) objects.set(path, { ...stored, version: 'second-version' });
      return overwrite();
    }
    objects.set(path, stored);
    uploaded++;
    if (loseReply) throw new Error('transport interrupted after commit');
    return new Response(null, { status: 200 });
  }));
  const executed = [];
  const step = { sleepUntil: async (_name, date) => vi.setSystemTime(date), do: async (name, options, run) => {
    for (let retries = 0; ; retries++) {
      executed.push(name);
      try { return await run(); }
      catch (error) {
        if (!error.retryable || retries >= options.retries.limit) throw error;
      }
    }
  } };
  return { deps, step, executed, objects, swept, userKey, expiryRequests, writes: () => uploaded };
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

describe('R2 expiry and access controls', () => {
  it('classifies namespaced XML, whitespace and content type without copying response data', async () => {
    const reply = await readS3Reply(new Response(
      '<?xml version="1.0"?><s3:Error xmlns:s3="urn:s3"><s3:Code> RequestExpired </s3:Code><s3:Message><![CDATA[Request has expired]]></s3:Message></s3:Error>',
      { status: 403, headers: { 'Content-Type': 'application/xml; charset=UTF-8' } },
    ));
    expect(reply).toMatchObject({ bodyFormat: 's3-xml', contentType: 'xml', code: 'RequestExpired', codePresent: true });
    expect(expiryRejected(reply)).toBe(true);
    const untrusted = await readS3Reply(new Response('<html><Code>RequestExpired</Code>secret-marker</html>',
      { status: 403, headers: { 'Content-Type': 'text/html' } }));
    expect(untrusted).toMatchObject({ bodyFormat: 'opaque', contentType: 'html', code: 'UnknownS3Code', codePresent: false });
    expect(expiryRejected(untrusted)).toBe(false);
    expect(JSON.stringify(untrusted)).not.toContain('secret-marker');
  });

  it('keeps the short TTL scoped to the isolated expiry probe', async () => {
    const now = new Date('2026-11-17T00:00:00Z');
    await expect(signSmokeExpiryPut('uploads/' + id, metadata, env, now)).rejects.toThrow('INVALID_BACKUP_UPLOAD');
    const signed = await signSmokeExpiryPut(key + '/expired', metadata, env, now);
    expect(new URL(signed.putUrl).searchParams.get('X-Amz-Expires')).toBe(String(SMOKE_EXPIRY_TTL_SECONDS));
  });

  it('requires the same URL and request before and after expiration plus a fresh positive control', async () => {
    const fixture = smokeFixture({ expiredReply: () => new Response(null, { status: 403 }) });
    await expect(runMigrationSmoke(fixture.deps, id, fixture.step, message => new Error(message))).resolves.toBe('MIGRATION_SMOKE_OK');
    const [before, after, fresh] = fixture.expiryRequests;
    expect(before).toEqual(after);
    expect(new URL(fresh.url).pathname).toBe(new URL(before.url).pathname);
    expect(new URL(fresh.url).searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_TTL_SECONDS));
    expect(fresh.headers).toEqual(before.headers);
    expect([...fixture.objects.keys()]).toEqual([fixture.userKey]);
  });

  it.each(['SignatureDoesNotMatch', 'AccessDenied', 'InvalidAccessKeyId', 'ExpiredToken', 'RequestTimeTooSkewed'])(
    'rejects explicit %s as expiry evidence', async code => {
      const fixture = smokeFixture({ expiredReply: () => s3(403, code) });
      expect(expiryNeedsControl(await readS3Reply(s3(403, code)))).toBe(false);
      await expect(runMigrationSmoke(fixture.deps, id, fixture.step, message => new Error(message)))
        .rejects.toThrow('SMOKE_INVALID_EXPIRED_ACCEPTANCE');
    },
  );

  it('fails on an opaque denial when the fresh control is also denied', async () => {
    const fixture = smokeFixture({ expiredReply: () => new Response(null, { status: 403 }), freshDenied: true });
    await expect(runMigrationSmoke(fixture.deps, id, fixture.step, message => new Error(message))).rejects.toThrow('SMOKE_SIGNED_PUT_FAILED');
  });

  it('requires PreconditionFailed at HTTP 412 and an unchanged R2 object version', async () => {
    const invalid = smokeFixture({ overwrite: () => s3(412, 'AccessDenied') });
    await expect(runMigrationSmoke(invalid.deps, id, invalid.step, message => new Error(message))).rejects.toThrow('SMOKE_OVERWRITE_NOT_REJECTED');
    const changed = smokeFixture({ changeVersionOnOverwrite: true });
    await expect(runMigrationSmoke(changed.deps, id, changed.step, message => new Error(message))).rejects.toThrow('SMOKE_OVERWRITE_CHANGED_OBJECT');
  });

  it('accepts a documented anonymous auth refusal and rejects unrelated denials', async () => {
    const denied = smokeFixture({ anonymous: () => s3(403, 'AccessDenied') });
    await expect(runMigrationSmoke(denied.deps, id, denied.step, message => new Error(message))).resolves.toBe('MIGRATION_SMOKE_OK');
    const unrelated = smokeFixture({ anonymous: () => s3(403, 'SignatureDoesNotMatch') });
    await expect(runMigrationSmoke(unrelated.deps, id, unrelated.step, message => new Error(message))).rejects.toThrow('SMOKE_PUBLIC_READ_NOT_REJECTED');
  });
});

it('keeps expiry control objects out of the migration job table', async () => {
  const ack = vi.fn();
  const head = vi.fn();
  const prepare = vi.fn();
  const retry = vi.fn();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await consumeUploads({ messages: [{ ack, retry, attempts: 1, timestamp: new Date(), body: {
      account: env.CLOUDFLARE_ACCOUNT_ID, bucket: UPLOAD_BUCKET, action: 'PutObject', eventTime: new Date().toISOString(),
      object: { key: key + '/expired', size: metadata.sizeBytes, eTag: etag },
    } }] }, { ...env, UPLOADS: { head }, JOBS: { prepare } });
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(log.mock.calls.some(([record]) => record.event === 'QUEUE_EXPIRY_CONTROL_SKIPPED')).toBe(true);
  } finally {
    log.mockRestore();
  }
});
