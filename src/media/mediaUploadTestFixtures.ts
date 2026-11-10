import { vi } from 'vitest';
import { directMediaUrl } from './directMediaUpload';

export const mediaFunctionUrl = 'https://functions.yandexcloud.net/testfunction';
export const rawInitData = 'auth_date=123&user=%7B%22id%22%3A42%7D&hash=test';

export function signedMediaResponse(init?: RequestInit, {
  expiresAt = Date.now() + 600_000,
  signature = 'b'.repeat(64),
} = {}): Response {
  if (typeof init?.body !== 'string') throw new Error('Missing signature request');
  const { storageKey } = JSON.parse(init.body);
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-SignedHeaders': 'content-length;content-type;host;if-none-match',
    'X-Amz-Signature': signature,
  });
  return Response.json({ storageKey, putUrl: `${directMediaUrl(storageKey)}?${query}`, expiresAt });
}

export function mockSignedMediaTransport(storage: typeof fetch, signer: typeof fetch = async (_url, init) => signedMediaResponse(init)) {
  vi.stubEnv('VITE_YANDEX_MEDIA_FUNCTION_URL', mediaFunctionUrl);
  vi.stubGlobal('Telegram', { WebApp: { initData: rawInitData } });
  const transport = vi.fn<typeof fetch>((url, init) =>
    url === mediaFunctionUrl ? signer(url, init) : storage(url, init));
  vi.stubGlobal('fetch', transport);
  return transport;
}
