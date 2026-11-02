// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { UserAvatarSnapshot } from '../data/cloud/user-avatar';
import { useCloudContactAvatarUrl } from './CloudContactAvatar';

const state = vi.hoisted(() => ({ db: {}, actor: 'tg:101',
  next: null as ((avatar: UserAvatarSnapshot) => void) | null,
  initial: { value: null, overridden: false, incomplete: false } as UserAvatarSnapshot,
  observed: vi.fn(), oldNext: null as ((avatar: UserAvatarSnapshot) => void) | null,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: state.actor }),
}));
vi.mock('../data/cloud/user-avatar', () => ({ UserAvatarRepository: class {
  observe(userId: string, realmId: string, next: (avatar: UserAvatarSnapshot) => void) {
    state.observed(userId, realmId); state.oldNext = state.next; state.next = next;
    next(state.initial); return { unsubscribe() {} };
  }
} }));
const contact = { userId: 'tg:202', telegramUserId: '202', relationshipId: 'realm-1', displayName: 'Анна' };
const portrait = (): UserAvatarSnapshot => ({ value: { version: '2026-11-03T00:00:00Z', revision: '00000000-0000-0000-0000-000000000001',
  small: new Blob(['x'.repeat(32)], { type: 'image/jpeg' }), large: new Blob(['y'.repeat(64)], { type: 'image/jpeg' }) },
  overridden: true, incomplete: false });
function Source({ person = contact }: { person?: typeof contact }) {
  const src = useCloudContactAvatarUrl(person);
  return <span data-testid="source">{src ?? 'initials'}</span>;
}
beforeEach(() => {
  state.db = {}; state.actor = 'tg:101'; state.initial = { value: null, overridden: false, incomplete: false };
  state.next = null; state.oldNext = null; state.observed.mockClear();
  const NativeURL = URL;
  let counter = 0;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:custom-' + ++counter);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('reactively replaces the portrait, falls back after clearing and revokes temporary URLs', async () => {
  state.initial = portrait();
  const view = render(<Source />);
  await waitFor(() => expect(screen.getByTestId('source').textContent).toBe('blob:custom-1'));
  act(() => state.next?.(portrait()));
  await waitFor(() => expect(screen.getByTestId('source').textContent).toBe('blob:custom-2'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:custom-1');
  act(() => state.next?.({ value: null, overridden: false, incomplete: false }));
  expect(screen.getByTestId('source').textContent).toBe('initials');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:custom-2');
  view.unmount();
});

it('discards a previous relationship subscription immediately when the subject changes', async () => {
  state.initial = portrait();
  const view = render(<Source />);
  await waitFor(() => expect(screen.getByTestId('source').textContent).toBe('blob:custom-1'));
  const stale = state.next;
  state.initial = { value: null, overridden: false, incomplete: false };
  view.rerender(<Source person={{ ...contact, relationshipId: 'realm-2' }} />);
  act(() => stale?.(portrait()));
  expect(screen.getByTestId('source').textContent).toBe('initials');
});

it('reads the signed actor from the personal realm and withholds incomplete binary data', async () => {
  state.initial = { ...portrait(), incomplete: true };
  const view = render(<Source person={{ ...contact, userId: 'tg:101' }} />);
  expect(state.observed).toHaveBeenCalledWith('tg:101', 'tg:101');
  expect(screen.getByTestId('source').textContent).toBe('initials');
  act(() => state.next?.(portrait()));
  await waitFor(() => expect(screen.getByTestId('source').textContent).toBe('blob:custom-1'));
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:custom-1');
});
