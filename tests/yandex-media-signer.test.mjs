import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import signer from '../infra/yandex-media-mvp/function/index.js';

const now = new Date('2026-11-10T12:00:00Z');
const origin = 'https://mezfit.example';
const env = {
  TELEGRAM_BOT_TOKEN: '42:testBot',
  MEDIA_S3_ACCESS_KEY_ID: 'testAccess',
  MEDIA_S3_SECRET_ACCESS_KEY: 'testSecret',
  MEDIA_ORIGINS: origin,
};
const storageKey = 'mvp-media/' + 'a'.repeat(64);
const upload = { storageKey, contentType: 'image/jpeg', sizeBytes: 6 };

function initData(fields = {}) {
  const params = new URLSearchParams({
    user: '{"id":123,"first_name":"Иван"}',
    signature: 'test-ed25519-field',
    auth_date: String(now.getTime() / 1000),
    ...fields,
  });
  params.sort();
  const key = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  const data = [...params].map(pair => pair.join('=')).join('\n');
  params.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return params.toString();
}

function post(body, options = {}) {
  return signer.handleRequest({
    httpMethod: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify(body),
    ...options.event,
  }, options.env ?? env, options.now ?? now);
}

describe('Yandex media signer', () => {
  it('signs only the requested object and PUT parameters for ten minutes', () => {
    const response = post({ ...upload, initData: initData() });
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({ 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store' });
    const payload = JSON.parse(response.body);
    expect(Object.keys(payload).sort()).toEqual(['expiresAt', 'putUrl', 'storageKey']);
    expect(payload.storageKey).toBe(storageKey);
    expect(payload.expiresAt).toBe(now.getTime() + 600_000);
    const url = new URL(payload.putUrl);
    expect(url.origin + url.pathname).toBe('https://storage.yandexcloud.net/mezfit-comm-poc-20261106/' + storageKey);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': 'testAccess/20261110/ru-central1/s3/aws4_request',
      'X-Amz-Date': '20261110T120000Z',
      'X-Amz-Expires': '600',
      'X-Amz-SignedHeaders': 'content-length;content-type;host;if-none-match',
      // Independent SigV4 fixture for PUT, length 6, image/jpeg and If-None-Match: *.
      'X-Amz-Signature': 'bc3c37159a9dc8955ee561c18afccd405f612302c7e91f4ebe7e3c44453d17eb',
    });
    expect(response.body).not.toContain(env.MEDIA_S3_SECRET_ACCESS_KEY);
    expect(response.body).not.toContain(env.TELEGRAM_BOT_TOKEN);
  });

  it('issues a new signature for the same key after expiry', () => {
    const request = { ...upload, initData: initData() };
    const first = JSON.parse(post(request).body);
    const second = JSON.parse(post(request, { now: new Date(now.getTime() + 601_000) }).body);
    expect(second.storageKey).toBe(first.storageKey);
    expect(second.putUrl).not.toBe(first.putUrl);
    expect(second.expiresAt).toBe(first.expiresAt + 601_000);
  });

  it.each([
    undefined,
    initData().replace('123', '124'),
    initData() + '&auth_date=1',
    initData({ auth_date: '1' }),
    initData({ auth_date: String(now.getTime() / 1000 + 61) }),
    initData({ user: '{"id":"123"}' }),
    initData({ user: 'null' }),
    initData({ user: '' }),
  ])('rejects invalid Telegram data without granting a PUT', badInitData => {
    const response = post({ ...upload, initData: badInitData, userId: 123 });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ code: 'TELEGRAM_AUTH_REQUIRED' });
  });

  it.each([
    { storageKey: 'other/' + 'a'.repeat(64) }, { storageKey: storageKey + '\n' },
    { storageKey: 'mvp-media/' + 'a'.repeat(63) }, { contentType: 'text/html' },
    { sizeBytes: 0 }, { sizeBytes: '6' }, { sizeBytes: 20 * 1024 * 1024 + 1 },
  ])('rejects invalid upload parameters: %j', override => {
    expect(post({ ...upload, ...override, initData: initData() }).statusCode).toBe(400);
  });

  it('handles preflight independently, enforces authentication and supports a configured allowlist', () => {
    const preflight = post(undefined, { event: { httpMethod: 'OPTIONS' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers).toMatchObject({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    expect(post(upload, { event: { headers: {} } }).statusCode).toBe(401);
    const request = { ...upload, initData: initData() };
    expect(post(request, { event: { headers: { Origin: 'https://elsewhere.example' } } }).statusCode).toBe(403);
    expect(post(request, { event: { httpMethod: 'GET' } }).statusCode).toBe(405);
    expect(post(request, { env: { ...env, MEDIA_S3_SECRET_ACCESS_KEY: '' } }).statusCode).toBe(503);
    expect(post(request, { env: { ...env, MEDIA_TELEGRAM_ALLOWLIST: '124' } }).statusCode).toBe(403);
    expect(post(request, { env: { ...env, MEDIA_TELEGRAM_ALLOWLIST: '124,123' } }).statusCode).toBe(200);
  });

  it('keeps public bucket policy grants limited to HTTPS object reads', () => {
    const policy = JSON.parse(readFileSync(new URL('../infra/yandex-media-mvp/policy.fragment.json', import.meta.url), 'utf8'));
    const grants = policy.Statement.filter(rule => rule.Effect === 'Allow');
    const resource = 'arn:aws:s3:::mezfit-comm-poc-20261106/mvp-media/*';
    expect(grants).toHaveLength(2);
    expect(grants.filter(rule => rule.Principal === '*')).toEqual([expect.objectContaining({
      Action: 's3:GetObject', Resource: resource, Condition: { Bool: { 'aws:SecureTransport': 'true' } },
    })]);
    expect(grants.find(rule => rule.Action === 's3:PutObject')).toMatchObject({
      Principal: { CanonicalUser: 'REPLACE-WITH-EXISTING-SIGNER-SA-ID' },
      Resource: resource,
      Condition: { Null: { 's3:if-none-match': 'false' } },
    });
  });
});
