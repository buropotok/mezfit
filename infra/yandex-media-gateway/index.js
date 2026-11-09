'use strict';
const { randomUUID } = require('node:crypto');
const { authorize } = require('./authorization');
const { createStorage } = require('./storage');
const { GatewayError, fail, hash, seal, unseal, validateMedia, matchesContent } = require('./protocol');

const TTL = 120;
const UPLOAD_WINDOW = 3600000;
const checksum = /^[A-Za-z0-9+/]{22}==$/;
const keyFor = proof => 'media/objects/' + hash(proof);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\u0000-\u001f]/.test(value) && !['.', '..'].includes(value);

function createHandler({ env, contracts, fetchImpl = fetch, storageFactory = createStorage, now = Date.now }) {
  return async (event = {}, invocation = {}) => {
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const responseHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (statusCode, body) => ({ statusCode, headers: responseHeaders, isBase64Encoded: false,
      body: statusCode === 204 ? '' : JSON.stringify(body) });
    try {
      const secret = env.MEDIA_PROVENANCE_KEY;
      if (!env.TELEGRAM_BOT_TOKEN || !env.MEDIA_ORIGIN || !env.MEDIA_BUCKET || !secret || secret.length < 32)
        fail(503, 'MEDIA_GATEWAY_NOT_CONFIGURED');
      if (headers.origin !== env.MEDIA_ORIGIN) fail(403, 'ORIGIN_FORBIDDEN');
      responseHeaders['Access-Control-Allow-Origin'] = env.MEDIA_ORIGIN;
      responseHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      responseHeaders['Access-Control-Allow-Headers'] = 'authorization, content-type, x-telegram-init-data';
      if (event.httpMethod === 'OPTIONS') return reply(204);
      if (event.httpMethod !== 'POST') fail(405, 'METHOD_NOT_ALLOWED');
      if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) fail(415, 'JSON_REQUIRED');
      if (typeof event.body !== 'string' || event.body.length > 24576 || event.isBase64Encoded) fail(400, 'INVALID_REQUEST');
      let body;
      try { body = JSON.parse(event.body); } catch { fail(400, 'INVALID_JSON'); }
      if (!body || !['upload-intent', 'confirm', 'read', 'remove'].includes(body.operation)
        || !['realmId', 'threadId', 'messageId', 'attachmentId'].every(field => validId(body[field]))) fail(400, 'INVALID_REQUEST');
      const { thread, message, attachment } = await authorize(fetchImpl, contracts, env, headers, body, fail);
      validateMedia(attachment);
      const storage = storageFactory(fetchImpl, env.MEDIA_BUCKET, invocation.token?.access_token);
      const metadata = { realmId: thread.realmId, messageId: message.id, attachmentId: attachment.id,
        authorUserId: attachment.authorUserId, mediaType: attachment.mediaType, mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes, durationSeconds: attachment.durationSeconds };
      const binding = hash(JSON.stringify([thread.id, thread.anchorKey, metadata]));
      function verify(proof) {
        const data = unseal(secret, proof);
        if (data.binding !== binding || data.version !== 1 || !Number.isSafeInteger(data.issuedAt)
          || typeof data.md5 !== 'string' || !checksum.test(data.md5)) fail(403, 'MEDIA_PROVENANCE_MISMATCH');
        return data;
      }
      if (body.operation === 'upload-intent') {
        if (attachment.uploadState === 'ready' || attachment.confirmedAt) fail(409, 'ATTACHMENT_ALREADY_UPLOADED');
        if (typeof body.filename !== 'string' || typeof body.md5 !== 'string' || !checksum.test(body.md5)) fail(400, 'INVALID_REQUEST');
        validateMedia(attachment, body.filename);
        const proof = body.proof ?? seal(secret, { version: 1, binding, md5: body.md5, nonce: randomUUID(), issuedAt: now() });
        const data = verify(proof);
        if (data.md5 !== body.md5) fail(400, 'CHECKSUM_MISMATCH');
        if (now() + TTL * 1000 > data.issuedAt + UPLOAD_WINDOW) fail(410, 'UPLOAD_INTENT_EXPIRED');
        const key = keyFor(proof);
        if (attachment.storageKey && attachment.storageKey !== key) fail(409, 'ATTACHMENT_KEY_CONFLICT');
        if (await storage.revoked(key)) fail(410, 'MEDIA_REMOVED');
        if (await storage.head(key)) fail(409, 'UPLOAD_ALREADY_PRESENT');
        const putHeaders = { 'Content-Type': attachment.mimeType, 'Content-MD5': body.md5,
          'Cache-Control': 'private, no-store', 'If-None-Match': '*',
          'x-amz-meta-mezfit-proof': proof, 'x-amz-tagging': 'mezfit-upload=pending' };
        const uploadUrl = await storage.sign(key, 'PUT', putHeaders, TTL);
        return reply(200, { uploadUrl, headers: putHeaders, proof, storageKey: key, expiresAt: new Date(now() + TTL * 1000).toISOString() });
      }
      const confirming = body.operation === 'confirm';
      if (confirming) verify(body.proof);
      const key = confirming ? keyFor(body.proof) : attachment.storageKey;
      if (typeof key !== 'string' || !/^media\/objects\/[a-f0-9]{64}$/.test(key)) fail(409, 'MEDIA_NOT_READY');
      if (confirming && attachment.storageKey && attachment.storageKey !== key) fail(409, 'ATTACHMENT_KEY_CONFLICT');
      const revocation = await storage.revoked(key);
      const removing = body.operation === 'remove';
      if (revocation && !removing) fail(410, 'MEDIA_REMOVED');
      const object = revocation ?? await storage.head(key);
      if (!object) fail(409, 'UPLOAD_MISSING');
      const proof = confirming ? body.proof : object.proof;
      const data = verify(proof);
      if (keyFor(proof) !== key || object.proof !== proof) fail(403, 'MEDIA_PROVENANCE_MISMATCH');
      if (removing) {
        if (!revocation) await storage.revoke(key, proof);
        await storage.remove(key);
        return reply(200, { removed: true });
      }
      const modified = Date.parse(object.modified);
      if (object.size !== attachment.sizeBytes || object.mime !== attachment.mimeType
        || object.etag !== '"' + Buffer.from(data.md5, 'base64').toString('hex') + '"'
        || !Number.isFinite(modified) || modified < data.issuedAt - 1000 || modified > data.issuedAt + UPLOAD_WINDOW)
        fail(422, 'MEDIA_VALIDATION_FAILED');
      const confirmation = { ...metadata, storageKey: key, confirmedAt: new Date(modified).toISOString() };
      const ready = attachment.uploadState === 'ready' && attachment.storageKey === key
        && attachment.confirmedAt === confirmation.confirmedAt;
      if (!confirming && !ready) fail(409, 'MEDIA_NOT_READY');
      if (!matchesContent(attachment.mimeType, await storage.sample(key, object.etag))) fail(422, 'MEDIA_CONTENT_MISMATCH');
      if (await storage.revoked(key)) fail(410, 'MEDIA_REMOVED');
      if (!ready) return reply(202, { code: 'ATTACHMENT_METADATA_PENDING', confirmation });
      await storage.retain(key);
      if (await storage.revoked(key)) fail(410, 'MEDIA_REMOVED');
      if (confirming) return reply(200, { confirmation });
      const readUrl = await storage.sign(key, 'GET', {}, TTL);
      return reply(200, { readUrl, expiresAt: new Date(now() + TTL * 1000).toISOString() });
    } catch (error) {
      return error instanceof GatewayError ? reply(error.status, { code: error.code })
        : reply(502, { code: 'MEDIA_GATEWAY_UNAVAILABLE' });
    }
  };
}

exports.createHandler = createHandler;
exports.handler = (event, invocation) => {
  const env = process.env;
  const configured = env.TELEGRAM_BOT_TOKEN && env.MEDIA_ORIGIN && env.MEDIA_BUCKET && env.MEDIA_PROVENANCE_KEY;
  const contracts = configured ? {
    ...require('./contracts/shared/approved-relationship'),
    ...require('./contracts/shared/discussion-anchor'),
    ...require('./contracts/worker/lib/telegram'),
    dbUrl: require('./contracts/dexie-cloud.json').dbUrl,
  } : {};
  return createHandler({ env, contracts })(event, invocation);
};
