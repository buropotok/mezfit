import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWorkoutSession } from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('current workout API runtime contract', () => {
  it('accepts the canonical active-session summary', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      session: { sessionId: 501, status: 'active' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getCurrentWorkoutSession('telegram-init')).resolves.toEqual({
      session: { sessionId: 501, status: 'active' },
    });
  });

  it('accepts the absence of an open workout session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ session: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getCurrentWorkoutSession('telegram-init')).resolves.toEqual({
      session: null,
    });
  });

  it('rejects malformed current-session state instead of trusting the TypeScript shape', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      session: { sessionId: 501, status: 'completed' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getCurrentWorkoutSession('telegram-init')).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_API_RESPONSE',
    });
  });
});
