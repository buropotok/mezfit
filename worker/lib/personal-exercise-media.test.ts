import { describe, expect, it, vi } from 'vitest';
import { handlePersonalExerciseMedia } from './personal-exercise-media';

vi.mock('./telegram', () => ({
  validateTelegramInitData: vi.fn(async (token: string) => {
    if (token !== 'signed') throw new Error('INVALID_TELEGRAM_AUTH');
    return { user: { id: 42 } };
  }),
}));

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0]);
const env = () => {
  const images = new Map<string, Uint8Array>();
  const bucket = {
    put: vi.fn(async (key: string, bytes: ArrayBuffer) => {
      images.set(key, new Uint8Array(bytes));
      return {};
    }),
    get: vi.fn(async (key: string) => {
      const bytes = images.get(key);
      const buffer = bytes ? new ArrayBuffer(bytes.length) : null;
      if (buffer && bytes) new Uint8Array(buffer).set(bytes);
      return buffer ? {
        body: new Blob([buffer], { type: 'image/png' }).stream(),
        httpMetadata: { contentType: 'image/png' },
        httpEtag: '"test"',
      } : null;
    }),
  };
  return { env: { TELEGRAM_BOT_TOKEN: 'secret', R2_BINDING_MEZFIT: bucket as unknown as R2Bucket }, bucket };
};

describe('personal exercise R2 assets', () => {
  it('requires verified Telegram identity for uploads', async () => {
    const { env: worker, bucket } = env();
    await expect(handlePersonalExerciseMedia(new Request('https://mezfit.test/api/exercise-media/personal', {
      method: 'POST', headers: { 'content-type': 'image/png' }, body: png,
    }), worker)).rejects.toThrow('INVALID_TELEGRAM_AUTH');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('validates actual bytes rather than trusting the claimed MIME', async () => {
    const { env: worker, bucket } = env();
    const response = await handlePersonalExerciseMedia(new Request('https://mezfit.test/api/exercise-media/personal', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed', 'content-type': 'image/png' },
      body: new Uint8Array(14),
    }), worker);
    expect(response.status).toBe(400);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('stores versioned bytes in R2 and serves the immutable reference', async () => {
    const { env: worker, bucket } = env();
    const response = await handlePersonalExerciseMedia(new Request('https://mezfit.test/api/exercise-media/personal', {
      method: 'POST', headers: { 'x-telegram-init-data': 'signed', 'content-type': 'image/png' },
      body: png,
    }), worker);
    expect(response.status).toBe(201);
    const result = await response.json() as { url: string };
    expect(result.url).toMatch(/^\/api\/exercise-media\/personal\/[a-f0-9-]{36}\?v=[a-f0-9]{64}$/);
    expect(bucket.put).toHaveBeenCalledTimes(1);
    const image = await handlePersonalExerciseMedia(new Request('https://mezfit.test' + result.url),
      worker, result.url.split('/')[4].split('?')[0]);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  });

  it('rejects missing or altered content versions rather than serving a different file', async () => {
    const { env: worker } = env();
    const response = await handlePersonalExerciseMedia(new Request(
      'https://mezfit.test/api/exercise-media/personal/11111111-1111-4111-8111-111111111111',
    ), worker, '11111111-1111-4111-8111-111111111111');
    expect(response.status).toBe(404);
  });
});
