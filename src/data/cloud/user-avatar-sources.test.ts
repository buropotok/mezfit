import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UserAvatarSnapshot } from './user-avatar';
import { UserAvatarSources } from './user-avatar-sources';

const stores: UserAvatarSources[] = [];
beforeEach(() => {
  const NativeURL = URL; let count = 0;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:avatar-' + ++count);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); vi.unstubAllGlobals(); });
function portrait(): UserAvatarSnapshot {
  return { value: { version: '2026-11-03T00:00:00Z', revision: '00000000-0000-0000-0000-000000000001',
    small: new Blob(['x'.repeat(32)], { type: 'image/jpeg' }), large: new Blob(['y'.repeat(64)], { type: 'image/jpeg' }) },
    overridden: true, incomplete: false };
}
function fixture() {
  const callbacks: Array<{ next: (data: UserAvatarSnapshot) => void; error: (reason: unknown) => void; stop: ReturnType<typeof vi.fn> }> = [];
  const repository = { observe: vi.fn((_user: string, _realm: string, next: (data: UserAvatarSnapshot) => void, error: (reason: unknown) => void) => {
    const stop = vi.fn(); callbacks.push({ next, error, stop }); return { unsubscribe: stop };
  }) };
  const store = new UserAvatarSources(repository, 'tg:101'); stores.push(store);
  return { store, repository, callbacks };
}

it('keeps a ready source and one reactive observer across screen remounts', () => {
  const { store, repository, callbacks } = fixture();
  const off = store.subscribe('tg:202', 'pair', vi.fn());
  callbacks[0].next(portrait());
  const first = store.get('tg:202', 'pair');
  off();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  expect(store.get('tg:202', 'pair')).toBe(first);
  store.subscribe('tg:202', 'pair', vi.fn());
  expect(repository.observe).toHaveBeenCalledTimes(1);
  expect(store.get('tg:202', 'pair').small).toBe('blob:avatar-1');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

it('observes replacement and reset while no screen is mounted', () => {
  const { store, callbacks } = fixture();
  const off = store.subscribe('tg:202', 'pair', vi.fn());
  callbacks[0].next(portrait()); off();
  callbacks[0].next(portrait());
  expect(store.get('tg:202', 'pair').small).toBe('blob:avatar-2');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
  callbacks[0].next({ value: null, overridden: false, incomplete: false });
  expect(store.get('tg:202', 'pair')).toEqual({ status: 'ready', custom: false });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-2');
});

it('creates large URLs on demand without replacing an already prepared compact source', () => {
  const { store, callbacks } = fixture();
  store.subscribe('tg:202', 'pair', vi.fn()); callbacks[0].next(portrait());
  store.subscribe('tg:202', 'pair', vi.fn(), 'large');
  expect(store.get('tg:202', 'pair')).toMatchObject({ small: 'blob:avatar-1', large: 'blob:avatar-2' });
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});

it('drops revoked relationship images and rejects a delayed callback from the old observer', () => {
  const { store, callbacks } = fixture();
  store.retain([{ userId: 'tg:202', relationshipId: 'pair' }]);
  store.subscribe('tg:202', 'pair', vi.fn()); callbacks[0].next(portrait());
  store.retain([]);
  expect(callbacks[0].stop).toHaveBeenCalledOnce();
  expect(store.get('tg:202', 'pair').status).toBe('error');
  callbacks[0].next(portrait());
  expect(store.get('tg:202', 'pair').small).toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
  store.retain([{ userId: 'tg:202', relationshipId: 'pair' }]);
  callbacks[1].next(portrait());
  expect(store.get('tg:202', 'pair').small).toBe('blob:avatar-2');
});

it('withholds incomplete data, retries on hydration and ignores pre-refresh callbacks', () => {
  const { store, callbacks } = fixture();
  store.subscribe('tg:202', 'pair', vi.fn()); callbacks[0].next({ ...portrait(), incomplete: true });
  expect(store.get('tg:202', 'pair').status).toBe('pending');
  store.refresh();
  callbacks[0].next(portrait());
  expect(store.get('tg:202', 'pair').status).toBe('pending');
  callbacks[1].next(portrait());
  expect(store.get('tg:202', 'pair').small).toBe('blob:avatar-1');
  callbacks[1].error(new Error('read failed'));
  expect(store.get('tg:202', 'pair').status).toBe('error');
  store.refresh(); callbacks[2].next(portrait());
  expect(store.get('tg:202', 'pair').small).toBe('blob:avatar-2');
});

it('keeps accounts isolated and invalidates callbacks and URLs on disposal', () => {
  const first = fixture(); const second = fixture();
  first.store.subscribe('tg:202', 'pair', vi.fn()); first.callbacks[0].next(portrait());
  expect(second.store.get('tg:202', 'pair').status).toBe('pending');
  first.store.dispose(); first.callbacks[0].next(portrait());
  expect(first.store.get('tg:202', 'pair').status).toBe('pending');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:avatar-1');
  expect(first.callbacks[0].stop).toHaveBeenCalledOnce();
});
