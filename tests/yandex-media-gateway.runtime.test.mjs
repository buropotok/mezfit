import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { validateTelegramInitData } from '../worker/lib/telegram';
import { checkApprovedAssignedPair } from '../shared/approved-relationship';
import { discussionAnchorKey } from '../shared/discussion-anchor';
import { relationshipRealmId, stableCloudRelationshipId } from '../shared/relationship-id';
import { buildPackage } from '../tools/yandex-media/package.mjs';
import { desiredBucket } from '../tools/yandex-media/reconcile.mjs';

const require = createRequire(import.meta.url);
const { createHandler } = require('../infra/yandex-media-gateway/index.js');
const { createStorage } = require('../infra/yandex-media-gateway/storage.js');
const env = { TELEGRAM_BOT_TOKEN: 'fake-test-bot', MEDIA_PROVENANCE_KEY: 'test-only-provenance-secret-over-32',
  MEDIA_ORIGIN: 'https://app.example', MEDIA_BUCKET: 'test' };
const contracts = { validateTelegramInitData, checkApprovedAssignedPair, discussionAnchorKey, dbUrl: 'https://dexie.example' };
const bytes = Buffer.from([255, 216, 255, 224, 0, 0, 0, 0]);
const md5 = createHash('md5').update(bytes);
const hex = md5.copy().digest('hex');
const intentData = { filename: 'photo.jpg', md5: md5.digest('base64') };
const now = Math.floor(Date.now() / 1000) * 1000;
function telegram(id) {
  const data = new URLSearchParams({ auth_date: String(now / 1000), user: JSON.stringify({ id, first_name: 'Test' }) });
  const key = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  data.set('hash', createHmac('sha256', key).update([...data].map(([k,v]) => k + '=' + v).join('\n')).digest('hex'));
  return data.toString();
}

async function fixture(coachId = '1', runtime = {}) {
  const realmId = await relationshipRealmId(coachId, '2');
  const scope = { realmId, coachClientId: realmId };
  const anchor = { kind: 'program', trainingPlanId: 'plan' };
  const thread = { ...scope, id: 'thread', owner: realmId, anchor, anchorKey: discussionAnchorKey(scope, anchor) };
  const message = { id: 'message', realmId, owner: 'tg:2', authorUserId: 'tg:2', threadId: thread.id };
  const attachment = { id: 'attachment', realmId, owner: 'tg:2', authorUserId: 'tg:2', messageId: message.id,
    mediaType: 'photo', mimeType: 'image/jpeg', sizeBytes: bytes.length, durationSeconds: null,
    uploadState: 'pending', storageKey: null, confirmedAt: null };
  const realm = { realmId, owner: null, name: 'Mezfit coach-client pilot' };
  const members = await Promise.all(['coach', 'client'].map(async (role, i) => ({
    id: await stableCloudRelationshipId('mmb', realmId + ':' + role), realmId,
    userId: 'tg:' + (i === 0 ? coachId : '2'), owner: null, roles: [role], accepted: true, invite: false,
  })));
  const rows = { discussionThreads: thread, discussionMessages: message, messageAttachments: attachment, realms: realm };
  let actor = 2, subject, object = null, marker = null;
  const fetchImpl = vi.fn(async url => {
    const path = new URL(url).pathname;
    if (path === '/token/validate') return Response.json({ valid: true, claims: { sub: 'tg:' + (subject ?? actor) } });
    if (path === '/my/members') return Response.json(members);
    return Response.json(rows[path.split('/')[2]]);
  });
  const storage = {
    head: vi.fn(async () => object), revoked: vi.fn(async () => marker),
    sign: vi.fn(async (_key, method) => 'https://storage.yandexcloud.net/test/object?method=' + method),
    sample: vi.fn(async () => bytes), retain: vi.fn(async () => {}),
    revoke: vi.fn(async (_key, proof) => { marker = { proof }; }),
    remove: vi.fn(async () => { object = null; }),
  };
  const handler = (runtime.createHandler ?? createHandler)({ env, contracts: runtime.contracts ?? contracts,
    fetchImpl, storageFactory: () => storage, now: () => now });
  async function call(operation, extra = {}, headers = {}) {
    const result = await handler({ httpMethod: 'POST',
      headers: { origin: env.MEDIA_ORIGIN, 'content-type': 'application/json', authorization: 'Bearer user',
        'x-telegram-init-data': telegram(actor), ...headers },
      body: JSON.stringify({ operation, realmId, threadId: thread.id, messageId: message.id,
        attachmentId: attachment.id, ...extra }),
    });
    return { ...result, json: JSON.parse(result.body) };
  }
  async function upload() {
    const intent = await call('upload-intent', intentData);
    expect(intent.statusCode).toBe(200);
    object = { proof: intent.json.proof, size: bytes.length, mime: 'image/jpeg',
      etag: '"' + hex + '"', modified: new Date(now).toUTCString() };
    return intent.json;
  }
  async function ready() {
    const intent = await upload();
    const result = await call('confirm', { proof: intent.proof });
    expect(result.statusCode).toBe(202);
    Object.assign(attachment, result.json.confirmation, { uploadState: 'ready' });
    return intent;
  }
  return { call, upload, ready, attachment, thread, message, storage, members, fetchImpl,
    setActor: value => { actor = value; }, setSubject: value => { subject = value; },
    setObject: value => { object = value; }, getObject: () => object };
}

describe('media authorization and lifecycle', () => {
  it('rejects forged Telegram data and a different Dexie subject before accessing storage', async () => {
    const f = await fixture();
    expect((await f.call('read', {}, { 'x-telegram-init-data': telegram(2).replace('hash=', 'hash=0') })).statusCode).toBe(401);
    f.setSubject(3);
    expect((await f.call('read')).statusCode).toBe(401);
    expect(f.storage.head).not.toHaveBeenCalled();
  });
  it('rejects an outsider, an unaccepted member and a changed anchor', async () => {
    const f = await fixture();
    f.setActor(3);
    expect((await f.call('read')).statusCode).toBe(403);
    f.setActor(2);
    f.members[0].accepted = false;
    expect((await f.call('upload-intent', intentData)).statusCode).toBe(403);
    f.members[0].accepted = true;
    f.thread.anchorKey = 'forged';
    expect((await f.call('upload-intent', intentData)).statusCode).toBe(403);
    expect(f.storage.sign).not.toHaveBeenCalled();
  });
  it('signs a conditional PUT and allows pair reads only after Dexie confirms metadata', async () => {
    const f = await fixture();
    const intent = await f.ready();
    expect(f.storage.sign).toHaveBeenCalledWith(intent.storageKey, 'PUT',
      expect.objectContaining({ 'Content-MD5': intentData.md5, 'If-None-Match': '*', 'x-amz-tagging': 'mezfit-upload=pending' }), 120);
    expect((await f.call('confirm', { proof: intent.proof })).statusCode).toBe(200);
    f.setActor(1);
    expect((await f.call('read')).statusCode).toBe(200);
    expect(f.storage.sign).toHaveBeenLastCalledWith(intent.storageKey, 'GET', {}, 120);
    expect((await f.call('remove')).statusCode).toBe(403);
  });
  it('rejects missing, oversized and disguised objects before promotion', async () => {
    const f = await fixture();
    const { proof } = await f.upload();
    const object = f.getObject();
    f.setObject(null);
    expect((await f.call('confirm', { proof })).json.code).toBe('UPLOAD_MISSING');
    f.setObject({ ...object, size: 1024 });
    expect((await f.call('confirm', { proof })).json.code).toBe('MEDIA_VALIDATION_FAILED');
    f.setObject(object);
    f.storage.sample.mockResolvedValue(Buffer.from('<script>'));
    expect((await f.call('confirm', { proof })).json.code).toBe('MEDIA_CONTENT_MISMATCH');
    expect(f.storage.retain).not.toHaveBeenCalled();
  });
  it('renews a missing upload without changing its identity', async () => {
    const f = await fixture();
    const intent = await f.upload();
    f.attachment.storageKey = intent.storageKey;
    f.setObject(null);
    expect((await f.call('upload-intent', { ...intentData, proof: intent.proof })).json.storageKey).toBe(intent.storageKey);
  });
  it('rejects a copied storage key in a different valid pair with the same athlete', async () => {
    const first = await fixture();
    await first.ready();
    const second = await fixture('3');
    Object.assign(second.attachment, { storageKey: first.attachment.storageKey, uploadState: 'ready',
      confirmedAt: first.attachment.confirmedAt });
    second.setObject(first.getObject());
    expect((await second.call('read')).statusCode).toBe(403);
    expect((await second.call('remove')).statusCode).toBe(403);
    expect(second.storage.sign).not.toHaveBeenCalled();
    expect(second.storage.remove).not.toHaveBeenCalled();
  });
  it('revokes access before deletion, then safely retries physical deletion', async () => {
    const f = await fixture();
    const intent = await f.ready();
    f.storage.remove.mockRejectedValueOnce(new Error('interrupted'));
    expect((await f.call('remove')).statusCode).toBe(502);
    expect((await f.call('read')).statusCode).toBe(410);
    expect((await f.call('remove')).statusCode).toBe(200);
    expect((await f.call('confirm', { proof: intent.proof })).statusCode).toBe(410);
    f.thread.anchor = { kind: 'program', trainingPlanId: 'another' };
    f.thread.anchorKey = discussionAnchorKey(f.thread, f.thread.anchor);
    expect((await f.call('remove')).statusCode).toBe(403);
    expect(f.storage.remove).toHaveBeenCalledTimes(2);
  });
  it('rejects an unrelated origin without making an upstream request', async () => {
    const f = await fixture();
    const result = await f.call('read', {}, { origin: 'https://unrelated.example' });
    expect(result.statusCode).toBe(403);
    expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('media deployment and storage', () => {
  it('runs the packaged gateway with its compiled shared contracts', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'mezfit-media-package-'));
    try {
      await buildPackage(pathToFileURL(folder + '/'));
      const pkg = require(join(folder, 'index.js'));
      const packagedContracts = { dbUrl: contracts.dbUrl,
        ...require(join(folder, 'contracts/shared/approved-relationship.js')),
        ...require(join(folder, 'contracts/shared/discussion-anchor.js')),
        ...require(join(folder, 'contracts/worker/lib/telegram.js')) };
      const f = await fixture('1', { createHandler: pkg.createHandler, contracts: packagedContracts });
      await f.ready();
      expect((await f.call('read')).statusCode).toBe(200);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
  it('samples with a bounded Range and refuses an upstream full response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(bytes, { status: 206 }))
      .mockResolvedValueOnce(new Response(bytes));
    const storage = createStorage(fetcher, 'test', 'runtime-iam');
    expect(await storage.sample('media/objects/x', '"etag"')).toEqual(bytes);
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Range: 'bytes=0-63', 'If-Match': '"etag"' });
    await expect(storage.sample('media/objects/x', '"etag"')).rejects.toMatchObject({ code: 'STORAGE_RANGE_REQUIRED' });
  });
  it('reconciles exact CORS and pending cleanup without permitting public grants', () => {
    const current = { name: 'mezfit-comm-poc-20261106', folderId: 'folder', versioning: 'VERSIONING_DISABLED' };
    const target = desiredBucket(current, env.MEDIA_ORIGIN, 'folder');
    expect(desiredBucket({ ...current, ...target }, env.MEDIA_ORIGIN, 'folder')).toEqual(target);
    expect(target.cors[0].allowedOrigins).toEqual([env.MEDIA_ORIGIN]);
    expect(target.lifecycleRules[0].filter.andOperator.tag).toEqual([{ key: 'mezfit-upload', value: 'pending' }]);
    expect(() => desiredBucket({ ...current, acl: { grants: [{ grantType: 'GRANT_TYPE_ALL_USERS' }] } },
      env.MEDIA_ORIGIN, 'folder')).toThrow();
  });
});
