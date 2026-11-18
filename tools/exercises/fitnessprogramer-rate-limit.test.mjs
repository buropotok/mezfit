import { describe, expect, it, vi } from 'vitest';
import { createDexieRequestQueue } from './fitnessprogramer-operator.mjs';

describe('FitnessProgramer Dexie rate limits', () => {
  it('waits for Retry-After and resends the same upload', async () => {
    let time = 0;
    const fetchRequest = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '12' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const wait = vi.fn(async delay => { time += delay; });
    const onThrottle = vi.fn();
    const request = createDexieRequestQueue({ fetchRequest, wait, clock: () => time, onThrottle });
    const body = Buffer.from('GIF89a');
    const init = { method: 'PUT', body };
    const url = 'https://example.invalid/blob/digest';

    expect((await request(url, init, 'UPLOAD_GIF')).status).toBe(201);
    expect(wait.mock.calls).toEqual([[12_000]]);
    expect(fetchRequest.mock.calls.map(([address, options]) => [address, options.method, options.body]))
      .toEqual([[url, 'PUT', body], [url, 'PUT', body]]);
    expect(onThrottle.mock.calls).toEqual([[{ operation: 'UPLOAD_GIF', retry: 1, waitMs: 12_000 }]]);
  });

  it('paces successive requests and preserves a non-retryable server response', async () => {
    let time = 0;
    const fetchRequest = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const wait = vi.fn(async delay => { time += delay; });
    const request = createDexieRequestQueue({ fetchRequest, wait, clock: () => time });

    await request('https://example.invalid/gif/1');
    expect((await request('https://example.invalid/gif/2')).status).toBe(403);
    expect(wait.mock.calls).toEqual([[350]]);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it('reports persistent rate limiting with the failed operation', async () => {
    let time = 0;
    const fetchRequest = vi.fn(async () => new Response(null, { status: 429 }));
    const request = createDexieRequestQueue({
      fetchRequest, wait: async delay => { time += delay; }, clock: () => time,
    });

    await expect(request('https://example.invalid/gif/digest', {}, 'VERIFY_GIF'))
      .rejects.toThrow('FITNESSPROGRAMER_VERIFY_GIF_RATE_LIMIT_EXHAUSTED');
    expect(fetchRequest).toHaveBeenCalledTimes(9);
  });
});
