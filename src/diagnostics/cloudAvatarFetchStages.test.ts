// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchCloudContactAvatar, type AvatarFetchStep } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('opt-in binary avatar transport stages', () => {
  it('reports successful HTTP, MIME and actual Blob validation without exposing credentials', async () => {
    const jpeg = new Uint8Array([255, 216, 255, ...Array(32).fill(0)]);
    const request = vi.fn(async () => new Response(jpeg, {
      status: 200, headers: { 'content-type': 'image/jpeg' },
    }));
    vi.stubGlobal('fetch', request);
    const stages: AvatarFetchStep[] = [];

    const image = await fetchCloudContactAvatar(
      'signed-user-secret', 'rlmvalid', 'tg:777', 'opaque-version',
      (stage) => { stages.push(stage); },
    );
    expect(image.size).toBe(jpeg.length);
    expect(stages).toEqual(['http-accepted', 'mime-accepted', 'blob-validated']);
    expect(request).toHaveBeenCalledOnce();
    const [path, options] = request.mock.calls[0];
    expect(String(path)).toContain('/api/cloud/profile/avatar');
    expect(options?.headers).toMatchObject({ 'x-telegram-init-data': 'signed-user-secret' });
  });

  it('stops after HTTP 200 when the MIME/type validation fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-an-image', {
      status: 200, headers: { 'content-type': 'text/html' },
    })));
    const stages: AvatarFetchStep[] = [];
    await expect(fetchCloudContactAvatar('secret', 'rlm', 'tg:3', 'version',
      (stage) => { stages.push(stage); })).rejects.toBeInstanceOf(ApiError);
    expect(stages).toEqual(['http-accepted']);
  });

  it('does not report success when the binary response is too small', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([255, 216, 255]), {
      status: 200, headers: { 'content-type': 'image/jpeg' },
    })));
    const stages: AvatarFetchStep[] = [];
    await expect(fetchCloudContactAvatar('secret', 'rlm', 'tg:3', 'version',
      (stage) => { stages.push(stage); })).rejects.toBeInstanceOf(ApiError);
    expect(stages).toEqual(['http-accepted', 'mime-accepted']);
  });
});
