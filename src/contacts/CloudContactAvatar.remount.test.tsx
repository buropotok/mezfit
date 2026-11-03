// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContactAvatarUrls } from '../data/cloud/contact-avatar-urls';
import { UserAvatarSources } from '../data/cloud/user-avatar-sources';
import type { UserAvatarSnapshot } from '../data/cloud/user-avatar';
import { AVATAR_LOADING_SRC, useCloudContactAvatarUrl } from './CloudContactAvatar';

let sources: UserAvatarSources;
let cache: ContactAvatarUrls;
const callbacks: Array<(value: UserAvatarSnapshot) => void> = [];
const observed = vi.fn();
const legacy = () => Promise.resolve(new Blob(['t'.repeat(32)], { type: 'image/jpeg' }));
const peer = { userId: 'tg:202', telegramUserId: '202', relationshipId: 'pair', displayName: 'Анна', avatarVersion: 'a'.repeat(64) };
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  actorUserId: 'tg:101', userAvatarSources: sources, avatarUrls: cache, loadAvatar: legacy,
}) }));
function portrait(): UserAvatarSnapshot {
  return { value: { version: '2026-11-03T00:00:00Z', revision: '00000000-0000-0000-0000-000000000001',
    small: new Blob(['x'.repeat(32)], { type: 'image/jpeg' }), large: new Blob(['y'.repeat(64)], { type: 'image/jpeg' }) },
    overridden: true, incomplete: false };
}
const rendered: Array<string | undefined> = [];
function Source() {
  const src = useCloudContactAvatarUrl(peer);
  rendered.push(src);
  return <img data-testid="avatar" src={src} alt="Аватар" />;
}
beforeEach(() => {
  callbacks.length = 0; rendered.length = 0; observed.mockClear();
  const NativeURL = URL; let count = 0;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:avatar-' + ++count);
    static revokeObjectURL = vi.fn();
  });
  sources = new UserAvatarSources({ observe(userId, realmId, next) {
    observed(userId, realmId); callbacks.push(next); return { unsubscribe() {} };
  } }, 'tg:101');
  sources.retain([peer]);
  cache = new ContactAvatarUrls();
});
afterEach(() => { cleanup(); sources.dispose(); cache.dispose(); vi.unstubAllGlobals(); });

it('never renders a cached Telegram portrait while an override is unresolved and reuses the override on the first remount render', async () => {
  await cache.load(peer, legacy);
  const first = render(<Source />);
  expect(rendered[0]).toBe(AVATAR_LOADING_SRC);
  expect(screen.getByTestId('avatar').getAttribute('src')).not.toBe('blob:avatar-1');
  act(() => callbacks[0](portrait()));
  await waitFor(() => expect(screen.getByTestId('avatar').getAttribute('src')).toBe('blob:avatar-2'));
  expect(rendered).not.toContain('blob:avatar-1');
  first.unmount();
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:avatar-2');
  rendered.length = 0;
  render(<Source />);
  expect(rendered[0]).toBe('blob:avatar-2');
  expect(observed).toHaveBeenCalledTimes(1);
});

it('permits the Telegram fallback only after a resolved reset, keeping incomplete overrides neutral', async () => {
  await cache.load(peer, legacy);
  render(<Source />);
  act(() => callbacks[0](portrait()));
  await waitFor(() => expect(screen.getByTestId('avatar').getAttribute('src')).toBe('blob:avatar-2'));
  act(() => callbacks[0]({ ...portrait(), incomplete: true }));
  expect(screen.getByTestId('avatar').getAttribute('src')).toBe(AVATAR_LOADING_SRC);
  expect(rendered).not.toContain('blob:avatar-1');
  act(() => callbacks[0]({ value: null, overridden: false, incomplete: false }));
  expect(screen.getByTestId('avatar').getAttribute('src')).toBe('blob:avatar-1');
});
