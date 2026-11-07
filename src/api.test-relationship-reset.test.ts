import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestClientRelationship } from './api';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('test relationship reset API boundary', () => {
  it('sends signed DELETE with a validated canonical Client Telegram ID', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await resetTestClientRelationship('signed-init', '202');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/coach/clients/202/test-relationship');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('x-telegram-init-data')).toBe('signed-init');
  });

  it('rejects invalid IDs without network or implicit numeric normalization', async () => {
    for (const id of ['0', '0202', 'tg:202', '202%2F1', '9007199254740992']) {
      await expect(resetTestClientRelationship('signed-init', id))
        .rejects.toMatchObject({ code: 'INVALID_CLIENT' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on a successful HTTP response with no removal acknowledgement', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: false }));
    await expect(resetTestClientRelationship('signed-init', '202'))
      .rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
  });
});
