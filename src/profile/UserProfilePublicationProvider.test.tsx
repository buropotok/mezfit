// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { UserProfilePublicationProvider, UserProfileSyncStatus } from './UserProfilePublicationProvider';

const state = vi.hoisted(() => ({
  actor: 'tg:202', db: {}, status: 'offline' as string, version: 'profile-v1' as string | null,
  listeners: new Map<string, (version: string | null) => void>(),
  publish: vi.fn<() => Promise<string | null>>(),
  confirm: vi.fn<(version: string) => Promise<boolean>>(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: state.actor, syncStatus: state.status }),
}));
vi.mock('../data/cloud/user-profile', () => ({ UserProfileRepository: class {
  constructor(_db: unknown, readonly actorUserId: string) {}
  observePublicationVersion(next: (version: string | null) => void) {
    state.listeners.set(this.actorUserId, next); next(state.version);
    return { unsubscribe: () => state.listeners.delete(this.actorUserId) };
  }
  publishOwn() { return state.publish(); }
  confirmOwnSync(version: string) { return state.confirm(version); }
} }));
vi.mock('../ui', () => ({
  Badge: ({ children, color }: { children: ReactNode; color: string }) => <span data-color={color}>{children}</span>,
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
}));
const ui = () => <UserProfilePublicationProvider><UserProfileSyncStatus /></UserProfilePublicationProvider>;
beforeEach(() => {
  state.actor = 'tg:202'; state.status = 'offline'; state.version = 'profile-v1'; state.listeners.clear();
  state.publish.mockReset().mockImplementation(async () => state.version);
  state.confirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

it('publishes offline locally and becomes green only after the awaited cloud acknowledgement', async () => {
  let finish: ((ok: boolean) => void) | undefined;
  state.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(ui());
  await waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
  expect(screen.getByText('Нет соединения').getAttribute('data-color')).toBe('gray');
  expect(state.confirm).not.toHaveBeenCalled();
  state.status = 'synced'; view.rerender(ui());
  await waitFor(() => expect(state.confirm).toHaveBeenCalledWith('profile-v1'));
  expect(screen.getByText('В ожидании').getAttribute('data-color')).toBe('yellow');
  await act(async () => { finish?.(true); });
  expect(screen.getByText('Синхронизирована').getAttribute('data-color')).toBe('green');
});

it('invalidates green status and republishes when profile data or its link set changes', async () => {
  state.status = 'synced';
  render(ui());
  await screen.findByText('Синхронизирована');
  state.status = 'offline'; state.version = 'profile-v2-with-new-link';
  act(() => state.listeners.get('tg:202')?.(state.version));
  await waitFor(() => expect(state.publish).toHaveBeenCalledTimes(2));
  expect(screen.getByText('Нет соединения')).toBeTruthy();
});

it('exposes a retryable publication error without starting a render/retry loop', async () => {
  state.publish.mockRejectedValueOnce(new Error('IndexedDB unavailable')).mockResolvedValue('profile-v1');
  render(ui());
  expect((await screen.findByText('Ошибка')).getAttribute('data-color')).toBe('red');
  expect(state.publish).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('Нет соединения');
  expect(state.publish).toHaveBeenCalledTimes(2);
});

it('does not acknowledge the next account with a previous account push completion', async () => {
  state.status = 'synced';
  let finish: ((ok: boolean) => void) | undefined;
  state.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(ui());
  await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
  state.actor = 'tg:303'; state.status = 'offline'; view.rerender(ui());
  await screen.findByText('Нет соединения');
  await act(async () => { finish?.(true); });
  expect(screen.queryByText('Синхронизирована')).toBeNull();
});

it('does not mark an unsaved questionnaire as synchronized', async () => {
  state.version = null; state.status = 'synced';
  render(ui());
  expect((await screen.findByText('Не сохранена')).getAttribute('data-color')).toBe('gray');
  expect(state.confirm).not.toHaveBeenCalled();
});

it('does not spin on failed cloud confirmation and permits an explicit retry', async () => {
  state.status = 'synced';
  state.confirm.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
  render(ui());
  await screen.findByText('Ошибка');
  expect(state.confirm).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('Синхронизирована');
  expect(state.confirm).toHaveBeenCalledTimes(2);
});
