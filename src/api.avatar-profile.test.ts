import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, diagnoseCloudContactProfileSync, syncCloudContactProfile } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('Telegram profile synchronization diagnostic API', () => {
  it('requests authenticated opt-in status through the current two-step profile flow', async () => {
    // The previous direct-to-Worker compression path was retired for the Mini App:
    // no Telegram photo means no Canvas conversion, but profile sync still runs.
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/api/cloud/profile/source') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ 'x-telegram-init-data': 'signed' });
        return new Response(null, {
          status: 204, headers: { 'x-mezfit-photo-status': 'no-photo' },
        });
      }
      expect(String(input)).toMatch(/^\/api\/cloud\/profile\/sync(\?diagnostic=1)?$/);
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        'x-telegram-init-data': 'signed',
        'x-mezfit-client-avatar-compression': '1',
      });
      expect(init?.body).toBeUndefined();
      return Response.json({
        changed: false,
        avatarStatus: 'telegram-unavailable',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    // The safe stage is returned only by an opt-in diagnostic call.
    expect(await diagnoseCloudContactProfileSync('signed')).toEqual({
      changed: false, avatarStatus: 'telegram-unavailable',
    });
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/cloud/profile/source',
      '/api/cloud/profile/sync?diagnostic=1',
    ]);

    expect(await syncCloudContactProfile('signed')).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/cloud/profile/source',
      '/api/cloud/profile/sync?diagnostic=1',
      '/api/cloud/profile/source',
      '/api/cloud/profile/sync',
    ]);
  });

  it('rejects unknown or malformed Worker diagnostic stages after the signed source step', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === '/api/cloud/profile/source') {
        return new Response(null, {
          status: 204, headers: { 'x-mezfit-photo-status': 'no-photo' },
        });
      }
      return Response.json({
        changed: false, avatarStatus: 'raw-telegram-file-id:secret',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(diagnoseCloudContactProfileSync('signed')).rejects.toMatchObject({
      status: 502, code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiError>);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/api/cloud/profile/source',
      '/api/cloud/profile/sync?diagnostic=1',
    ]);
  });
});
