import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactAvatarUrls } from './contact-avatar-urls';
const peer = { relationshipId: 'realm', userId: 'tg:202', avatarVersion: 'version' };
afterEach(() => vi.unstubAllGlobals());
describe('account-owned avatar URLs', () => {
  it('does not recreate or reload a cached portrait and revokes it on access change', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:portrait'), revokeObjectURL: vi.fn() });
    const cache = new ContactAvatarUrls(), load = vi.fn(async () => new Blob(['portrait']));
    await Promise.all([cache.load(peer, load), cache.load(peer, load)]);
    expect(load).toHaveBeenCalledTimes(1); expect(cache.get(peer)).toBe('blob:portrait');
    await cache.load(peer, load); expect(load).toHaveBeenCalledTimes(1);
    cache.retain([]); expect(cache.get(peer)).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:portrait');
  });
  it('caches both sizes independently and drops stale same-version legacy blobs', async () => {
    let count = 0;
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:portrait-' + (++count)),
      revokeObjectURL: vi.fn(),
    });
    const cache = new ContactAvatarUrls();
    const load = vi.fn(async () => new Blob(['portrait']));
    expect(await cache.load(peer, load)).toBe('blob:portrait-1');
    expect(await cache.load(peer, load, 'large')).toBe('blob:portrait-2');
    expect(load).toHaveBeenCalledTimes(2);
    const upgraded = { ...peer, avatarMode: '110' };
    cache.retain([upgraded]);
    expect(cache.get(peer)).toBeUndefined();
    expect(await cache.load(upgraded, load)).toBe('blob:portrait-3');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('discards pending bytes after revocation or account disposal', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
    let finish: (value: Blob) => void = () => {};
    const pending = new Promise<Blob>(resolve => { finish = resolve; });
    const cache = new ContactAvatarUrls(), result = cache.load(peer, () => pending);
    cache.dispose(); finish(new Blob(['old portrait']));
    expect(await result).toBeUndefined(); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
