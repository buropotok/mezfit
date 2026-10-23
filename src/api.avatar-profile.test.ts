import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, diagnoseCloudContactProfileSync, syncCloudContactProfile } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('Telegram profile synchronization diagnostic API', () => {
  it('requests authenticated opt-in status without changing the normal profile contract', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      changed: false, avatarStatus: 'telegram-unavailable',
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await diagnoseCloudContactProfileSync('signed')).toEqual({
      changed: false, avatarStatus: 'telegram-unavailable',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/cloud/profile/sync?diagnostic=1', {
      method: 'POST',
      headers: expect.any(Headers),
    });
    const headers = fetchMock.mock.calls[0][1]?.headers;
    expect(headers).toBeInstanceOf(Headers);
    expect((headers as Headers).get('x-telegram-init-data')).toBe('signed');

    expect(await syncCloudContactProfile('signed')).toBe(false);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/cloud/profile/sync');
  });

  it('rejects unknown or malformed Worker diagnostic stages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      changed: false, avatarStatus: 'raw-telegram-file-id:secret',
    })));
    await expect(diagnoseCloudContactProfileSync('signed')).rejects.toMatchObject({
      status: 502, code: 'INVALID_API_RESPONSE',
    } satisfies Partial<ApiError>);
  });
});
