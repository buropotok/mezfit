// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { UserAvatarSnapshot } from '../data/cloud/user-avatar';
import { UserAvatarEditor } from './UserAvatarEditor';

const state = vi.hoisted(() => ({
  db: {}, save: vi.fn(), reset: vi.fn(), compress: vi.fn(),
  snapshot: { value: null, overridden: false, incomplete: false } as UserAvatarSnapshot,
  next: null as ((value: UserAvatarSnapshot) => void) | null,
  fail: null as (() => void) | null,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:101', selfAvatars: [] }),
}));
vi.mock('../contacts/CloudContactAvatar', () => ({ useCloudContactAvatarUrl: () => 'blob:portrait' }));
vi.mock('../media/telegram-avatar-compress', () => ({ compressUserAvatar: (...args: unknown[]) => state.compress(...args) }));
vi.mock('../data/cloud/user-avatar', () => ({ UserAvatarRepository: class {
  actorUserId = 'tg:101';
  observe(_user: string, _realm: string, next: (value: UserAvatarSnapshot) => void, fail: () => void) {
    state.next = next; state.fail = fail; next(state.snapshot); return { unsubscribe() {} };
  }
  save(...args: unknown[]) { return state.save(...args); }
  reset(...args: unknown[]) { return state.reset(...args); }
} }));
vi.mock('../ui/primitives', () => ({ Avatar: ({ src }: { src?: string }) => <img alt="Аватар" src={src} /> }));
vi.mock('../ui', () => ({
  Text: ({ children, role }: { children: ReactNode; role?: string }) => <span role={role}>{children}</span>,
  Button: ({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
}));
const contact = { userId: 'tg:202', relationshipId: 'realm-1', telegramUserId: '202', displayName: 'Анна' };
const image = () => new Blob(['x'.repeat(32)], { type: 'image/jpeg' });
const choose = () => fireEvent.change(document.querySelector('input[type=file]')!, {
  target: { files: [new File(['x'.repeat(32)], 'portrait.png', { type: 'image/png' })] },
});
beforeEach(() => {
  state.snapshot = { value: null, overridden: false, incomplete: false };
  state.save.mockReset().mockResolvedValue(undefined);
  state.reset.mockReset().mockResolvedValue(undefined);
  state.compress.mockReset().mockResolvedValue({ small: image(), large: image() });
});
afterEach(cleanup);

it('compresses a user file before the local save and allows retry after failure', async () => {
  state.save.mockRejectedValueOnce(new Error('Недостаточно места'));
  render(<UserAvatarEditor />);
  choose();
  await screen.findByText('Недостаточно места');
  choose();
  await screen.findByText('Аватар сохранён на устройстве.');
  expect(state.compress).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenLastCalledWith({ small: expect.any(Blob), large: expect.any(Blob) }, undefined);
});

it('shows reset and override labels only while editing the contact', async () => {
  state.snapshot = { value: { version: '2026-11-03T00:00:00Z', revision: '00000000-0000-0000-0000-000000000001', small: image(), large: image() }, overridden: true, incomplete: false };
  const view = render(<UserAvatarEditor contact={contact} editable={false} />);
  expect(screen.queryByText('Переопределено в этой связи')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<UserAvatarEditor contact={contact} />);
  expect(screen.getByText('Переопределено в этой связи')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить аватар' }));
  await waitFor(() => expect(state.reset).toHaveBeenCalledWith('tg:202', 'realm-1'));
  await screen.findByText('Аватар сохранён на устройстве.');
});

it('does not write a compressed image after navigation to a different contact', async () => {
  let finish: ((value: { small: Blob; large: Blob }) => void) | undefined;
  state.compress.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<UserAvatarEditor contact={contact} />);
  choose();
  view.rerender(<UserAvatarEditor contact={{ ...contact, userId: 'tg:303', relationshipId: 'realm-2' }} />);
  await act(async () => { finish?.({ small: image(), large: image() }); });
  expect(state.save).not.toHaveBeenCalled();
  expect(screen.queryByText('Аватар сохранён на устройстве.')).toBeNull();
});

it('keeps a failed old save from changing the next contact and prevents duplicate uploads', async () => {
  let reject: ((reason: Error) => void) | undefined;
  state.save.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const view = render(<UserAvatarEditor contact={contact} />);
  choose(); choose();
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  expect(state.save).toHaveBeenCalledWith(expect.any(Object), { userId: 'tg:202', realmId: 'realm-1' });
  view.rerender(<UserAvatarEditor contact={{ ...contact, userId: 'tg:303', relationshipId: 'realm-2' }} />);
  await act(async () => { reject?.(new Error('Старая ошибка')); });
  expect(screen.queryByText('Старая ошибка')).toBeNull();
  expect(screen.getByRole('button', { name: 'Загрузить аватар' })).toHaveProperty('disabled', false);
});

it('withholds replacement while bytes are still downloading and recovers after a fresh read', () => {
  state.snapshot = { value: null, overridden: false, incomplete: true };
  render(<UserAvatarEditor contact={contact} />);
  expect(screen.getByRole('button', { name: 'Загрузить аватар' })).toHaveProperty('disabled', true);
  act(() => state.next?.({ value: null, overridden: false, incomplete: false }));
  expect(screen.getByRole('button', { name: 'Загрузить аватар' })).toHaveProperty('disabled', false);
});
