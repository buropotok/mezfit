import { describe, expect, it } from 'vitest';
import { TelegramAuthError, validateTelegramInitData } from './telegram';

const encoder = new TextEncoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedInitData(botToken: string, authDate: number, startParam?: string): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAEAAAE',
    user: JSON.stringify({ id: 100500, first_name: 'Test', username: 'mezfit_test' }),
  });
  if (startParam) params.set('start_param', startParam);

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  params.set('hash', toHex(await hmacSha256(secretKey, dataCheckString)));
  return params.toString();
}

describe('validateTelegramInitData', () => {
  it('accepts a correctly signed current payload', async () => {
    const now = new Date('2026-09-09T00:00:00Z');
    const initData = await signedInitData('123456:test-token', Math.floor(now.getTime() / 1000));
    const result = await validateTelegramInitData(initData, '123456:test-token', now);
    expect(result.user.id).toBe(100500);
    expect(result.user.first_name).toBe('Test');
  });

  it('returns a signed Mini App start parameter', async () => {
    const now = new Date('2026-09-09T00:00:00Z');
    const startParam = `invite_${'a'.repeat(36)}`;
    const initData = await signedInitData('123456:test-token', Math.floor(now.getTime() / 1000), startParam);
    const result = await validateTelegramInitData(initData, '123456:test-token', now);
    expect(result.startParam).toBe(startParam);
  });

  it('rejects tampered payloads', async () => {
    const now = new Date('2026-09-09T00:00:00Z');
    const initData = (await signedInitData('123456:test-token', Math.floor(now.getTime() / 1000))).replace('Test', 'Other');
    await expect(validateTelegramInitData(initData, '123456:test-token', now)).rejects.toBeInstanceOf(TelegramAuthError);
  });

  it('rejects stale payloads', async () => {
    const now = new Date('2026-09-09T00:00:00Z');
    const old = Math.floor(now.getTime() / 1000) - 25 * 60 * 60;
    const initData = await signedInitData('123456:test-token', old);
    await expect(validateTelegramInitData(initData, '123456:test-token', now)).rejects.toThrow('expired');
  });
});
