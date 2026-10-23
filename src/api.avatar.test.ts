// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnoseCloudContactProfileSync, inspectTelegramAvatarSource, syncCloudContactProfile } from './api';
import { compressTelegramAvatar } from './media/telegram-avatar-compress';

vi.mock('./media/telegram-avatar-compress', () => ({
  compressTelegramAvatar: vi.fn(async () => ({
    small: new Blob([new Uint8Array(36)], { type: 'image/jpeg' }),
    large: new Blob([new Uint8Array(52)], { type: 'image/jpeg' }),
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('client-only Telegram avatar compression API flow', () => {
  it('passes a signed JPEG source to Canvas and uploads bounded results without Worker transforms', async () => {
    const version = 'a'.repeat(64);
    const jpeg = new Uint8Array([255, 216, 255, ...Array(33).fill(0)]);
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/source')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ 'x-telegram-init-data': 'signed' });
        return new Response(jpeg.slice().buffer, {
          headers: {
            'content-type': 'image/jpeg',
            'x-mezfit-photo-version': version,
          },
        });
      }
      expect(url).toBe('/api/cloud/profile/sync');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        'x-telegram-init-data': 'signed',
        'x-mezfit-client-avatar-compression': '1',
      });
      const form = init?.body;
      expect(form).toBeInstanceOf(FormData);
      expect((form as FormData).get('photoVersion')).toBe(version);
      expect((form as FormData).get('small')).toBeInstanceOf(Blob);
      expect((form as FormData).get('large')).toBeInstanceOf(Blob);
      return Response.json({ changed: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await syncCloudContactProfile('signed')).toBe(true);
    expect(compressTelegramAvatar).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the source processing off Worker when the Telegram user has no photo', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/source')) {
        return new Response(null, { status: 204, headers: { 'x-mezfit-photo-status': 'no-photo' } });
      }
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toMatchObject({ 'x-mezfit-client-avatar-compression': '1' });
      return Response.json({ changed: false, avatarStatus: 'no-photo' });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await diagnoseCloudContactProfileSync('signed'))
      .toEqual({ changed: false, avatarStatus: 'no-photo' });
    expect(compressTelegramAvatar).not.toHaveBeenCalled();
  });

  it('rejects unsigned image version and does not upload untrusted media', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      new Uint8Array(36).buffer, {
        headers: { 'content-type': 'image/jpeg', 'x-mezfit-photo-version': 'untrusted' },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncCloudContactProfile('signed')).rejects.toThrow('Некорректная фотография Telegram');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(compressTelegramAvatar).not.toHaveBeenCalled();
  });
  it('retries once when the Telegram photo changes while Canvas compression was running', async () => {
    let sourceCalls = 0;
    let uploadCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/source')) {
        sourceCalls += 1;
        return new Response(new Uint8Array(36).buffer, {
          headers: {
            'content-type': 'image/jpeg',
            'x-mezfit-photo-version': String(sourceCalls).repeat(64),
          },
        });
      }
      uploadCalls += 1;
      return uploadCalls === 1
        ? Response.json({ error: { code: 'STALE_AVATAR_SOURCE' } }, { status: 409 })
        : Response.json({ changed: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await syncCloudContactProfile('signed')).toBe(true);
    expect(sourceCalls).toBe(2);
    expect(uploadCalls).toBe(2);
    expect(compressTelegramAvatar).toHaveBeenCalledTimes(2);
  });

  it('still synchronizes profile names when the Telegram photo service is unavailable', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      calls.push(String(input));
      if (String(input).endsWith('/source')) {
        return Response.json({ error: { code: 'TELEGRAM_PROFILE_UNAVAILABLE' } }, { status: 502 });
      }
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toMatchObject({ 'x-mezfit-client-avatar-compression': '1' });
      return Response.json({ changed: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await syncCloudContactProfile('signed')).toBe(true);
    expect(calls).toEqual(['/api/cloud/profile/source', '/api/cloud/profile/sync']);
    expect(compressTelegramAvatar).not.toHaveBeenCalled();
  });

  it('reports Telegram download errors while still committing other profile metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/source')) {
        return Response.json({ error: { code: 'TELEGRAM_PHOTO_DOWNLOAD_FAILED' } }, { status: 502 });
      }
      expect(init?.body).toBeUndefined();
      return Response.json({ changed: true, avatarStatus: 'unchanged' });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await diagnoseCloudContactProfileSync('signed'))
      .toEqual({ changed: true, avatarStatus: 'download-failed' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(compressTelegramAvatar).not.toHaveBeenCalled();
  });

  it('does not silently hide unrelated server-side 502 failures as Telegram photo errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(
      { error: { code: 'CLOUD_PROFILE_UNAVAILABLE' } }, { status: 502 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncCloudContactProfile('signed')).rejects.toThrow('Не удалось получить фотографию Telegram');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a bodyless 204 source when the photo changes before the second request', async () => {
    let sourceCalls = 0;
    let syncCalls = 0;
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/source')) {
        sourceCalls++;
        if (sourceCalls === 1) {
          return new Response(null, { status: 204, headers: { 'x-mezfit-photo-status': 'unchanged' } });
        }
        return new Response(new Uint8Array(36).buffer, {
          headers: {
            'content-type': 'image/jpeg',
            'x-mezfit-photo-version': 'a'.repeat(64),
          },
        });
      }
      syncCalls++;
      if (syncCalls === 1) {
        expect(init?.body).toBeUndefined();
        expect(init?.headers).toMatchObject({
          'x-mezfit-client-avatar-compression': '1',
        });
        return Response.json({ error: { code: 'STALE_AVATAR_SOURCE' } }, { status: 409 });
      }
      expect(init?.body).toBeInstanceOf(FormData);
      return Response.json({ changed: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await syncCloudContactProfile('signed')).toBe(true);
    expect(calls).toEqual([
      '/api/cloud/profile/source', '/api/cloud/profile/sync',
      '/api/cloud/profile/source', '/api/cloud/profile/sync',
    ]);
    expect(compressTelegramAvatar).toHaveBeenCalledTimes(1);
  });

});

describe('read-only Telegram Bot API photo inspection', () => {
  // In Vitest's jsdom environment, its Blob is not a streaming BodyInit for Node Response.
  // Use raw network bytes; Response.blob() still verifies the runtime JPEG MIME/size contract.
  const payload = new ArrayBuffer(36);

  it('downloads matching source bytes without compression or cloud writes', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('/api/cloud/profile/source?diagnostic=1');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ 'x-telegram-init-data': 'signed' });
      return new Response(payload, {
        headers: { 'content-type': 'image/jpeg', 'x-mezfit-photo-comparison': 'same' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await inspectTelegramAvatarSource('signed');
    expect(result.comparison).toBe('same');
    expect(result.image?.size).toBe(36);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(compressTelegramAvatar).not.toHaveBeenCalled();
  });

  it('reports an unsaved version and supports cancellation of the read', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(payload, {
        headers: { 'content-type': 'image/jpeg', 'x-mezfit-photo-comparison': 'different' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await inspectTelegramAvatarSource('signed', controller.signal)).comparison).toBe('different');
  });

  it('handles no visible Telegram photo without inspecting cloud or starting image decoding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 204, headers: { 'x-mezfit-photo-status': 'no-photo' },
    })));
    expect(await inspectTelegramAvatarSource('signed')).toEqual({ comparison: 'no-photo', image: null });
    expect(compressTelegramAvatar).not.toHaveBeenCalled();
  });

  it('rejects malformed status, mime, comparison and oversized binary data', async () => {
    for (const response of [
      new Response(null, { status: 204, headers: { 'x-mezfit-photo-status': 'unchanged' } }),
      new Response(payload, { headers: { 'content-type': 'image/png', 'x-mezfit-photo-comparison': 'same' } }),
      new Response(payload, { headers: { 'content-type': 'image/jpeg', 'x-mezfit-photo-comparison': 'unexpected' } }),
      new Response(payload, { headers: {
        'content-type': 'image/jpeg', 'x-mezfit-photo-comparison': 'same', 'content-length': '20000001',
      } }),
      new Response(new ArrayBuffer(5), {
        headers: { 'content-type': 'image/jpeg', 'x-mezfit-photo-comparison': 'same' },
      }),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      await expect(inspectTelegramAvatarSource('signed')).rejects.toThrow();
    }
  });

  it('requires signed Telegram identity and surfaces Worker errors safely', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { code: 'TELEGRAM_PROFILE_UNAVAILABLE' } }, { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(inspectTelegramAvatarSource('')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(inspectTelegramAvatarSource('signed')).rejects.toThrow('Не удалось получить фотографию Telegram');
  });
});
