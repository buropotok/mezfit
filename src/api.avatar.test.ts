// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diagnoseCloudContactProfileSync, syncCloudContactProfile } from './api';
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
});
