// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ContactUserProfile, UserProfileDraft, UserProfileField } from '../data/cloud/user-profile';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { PublishedUserProfile } from './PublishedUserProfile';

const source = vi.hoisted(() => ({
  db: {}, data: null as ContactUserProfile | null,
  next: null as ((data: ContactUserProfile) => void) | null,
  error: null as (() => void) | null,
  save: vi.fn<(...args: unknown[]) => Promise<ContactUserProfile>>(),
  reset: vi.fn<(...args: unknown[]) => Promise<ContactUserProfile>>(),
}));
const profile = { firstName: 'Анна', lastName: 'Иванова', email: '', phone: '', birthDate: '',
  sex: 'undisclosed' as const, weightKg: null, updatedAt: '2026-11-02T00:00:00Z' };
const initial = (): ContactUserProfile => ({ published: profile,
  profile: { ...profile, firstName: 'Имя тренера' }, overridden: ['firstName'], canEdit: true, incomplete: false });
const resetData = (): ContactUserProfile => ({ ...initial(), profile, overridden: [] });
const contact: CloudContact = { relationshipId: 'realm-1', userId: 'tg:202', telegramUserId: '202', displayName: 'Анна' };
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: source.db, actorUserId: 'tg:101' }),
}));
vi.mock('../data/cloud/user-profile', async importOriginal => ({
  ...await importOriginal<typeof import('../data/cloud/user-profile')>(),
  UserProfileRepository: class {
    observeContact(_user: string, _realm: string, next: (data: ContactUserProfile) => void, error: () => void) {
      source.next = next; source.error = error;
      if (source.data) next(source.data);
      return { unsubscribe() {} };
    }
    saveContactOverrides(...args: unknown[]) { return source.save(...args); }
    resetContactOverride(...args: unknown[]) { return source.reset(...args); }
  },
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick?: () => void }) =>
    <button disabled={disabled} onClick={onClick}>{children}</button>,
  GlassSurface: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));
vi.mock('./UserProfileForm', () => ({
  UserProfileForm: ({ initialProfile, onSave, onCancel }: { initialProfile: UserProfileDraft;
    onSave: (draft: UserProfileDraft, fields: UserProfileField[]) => Promise<void>; onCancel: () => void }) =>
    <div aria-label="Редактор переопределений">
      <button onClick={() => { void onSave({ ...initialProfile, firstName: 'Новое переопределение' }, ['firstName']); }}>Записать имя</button>
      <button onClick={onCancel}>Отменить</button>
    </div>,
}));
beforeEach(() => {
  source.data = initial(); source.next = null; source.error = null;
  source.save.mockReset().mockResolvedValue(initial());
  source.reset.mockReset().mockResolvedValue(resetData());
});
afterEach(cleanup);

it('opens the reused editor and persists only deliberately changed fields', async () => {
  source.save.mockResolvedValueOnce({ ...initial(), profile: { ...profile, firstName: 'Новое переопределение' } });
  render(<PublishedUserProfile contact={contact} />);
  expect(screen.getByText('Имя тренера')).toBeTruthy();
  expect(screen.getByText('Переопределено в этой связи')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }));
  fireEvent.click(screen.getByRole('button', { name: 'Записать имя' }));
  await waitFor(() => expect(source.save).toHaveBeenCalledWith('tg:202', 'realm-1', { firstName: 'Новое переопределение' }));
  await screen.findByText('Переопределения сохранены на устройстве.');
  expect(screen.queryByLabelText('Редактор переопределений')).toBeNull();
  expect(screen.getByText('Новое переопределение')).toBeTruthy();
});

it('resets a field to current published data and retains a retryable error on failure', async () => {
  source.reset.mockRejectedValueOnce(new Error('IndexedDB unavailable')).mockResolvedValueOnce(resetData());
  render(<PublishedUserProfile contact={contact} />);
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить: Имя' }));
  await screen.findByText('Не удалось сбросить переопределение. Повторите действие.');
  expect(screen.getByText('Имя тренера')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить: Имя' }));
  await screen.findByText('Сброс сохранён на устройстве. Используются данные клиента.');
  expect(source.reset).toHaveBeenLastCalledWith('tg:202', 'realm-1', 'firstName');
  expect(screen.getByText('Анна')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Сбросить: Имя' })).toBeNull();
});

it('keeps the editor mounted when a background read fails', () => {
  render(<PublishedUserProfile contact={contact} />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }));
  act(() => source.error?.());
  expect(screen.getByLabelText('Редактор переопределений')).toBeTruthy();
  expect(screen.getByText('Не удалось обновить анкету. Черновик сохранён в форме.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
});

it('ignores an old contact save after navigation to another contact', async () => {
  let finish: ((data: ContactUserProfile) => void) | undefined;
  source.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<PublishedUserProfile contact={contact} />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }));
  fireEvent.click(screen.getByRole('button', { name: 'Записать имя' }));
  source.data = { ...resetData(), profile: { ...profile, firstName: 'Другой клиент' } };
  view.rerender(<PublishedUserProfile contact={{ ...contact, relationshipId: 'realm-2', userId: 'tg:303', telegramUserId: '303' }} />);
  expect(screen.getByText('Другой клиент')).toBeTruthy();
  await act(async () => { finish?.(initial()); });
  expect(screen.getByText('Другой клиент')).toBeTruthy();
  expect(screen.queryByText('Переопределения сохранены на устройстве.')).toBeNull();
});

it('withholds editing during a partial override download and from a read-only participant', () => {
  source.data = { ...initial(), incomplete: true };
  const view = render(<PublishedUserProfile contact={contact} />);
  expect(screen.getByText('Переопределения ещё загружаются. Повторите позже.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Изменить анкету' })).toBeNull();
  act(() => source.next?.({ ...initial(), canEdit: false }));
  expect(screen.queryByRole('button', { name: 'Изменить анкету' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Сбросить: Имя' })).toBeNull();
  view.unmount();
});

it('retains the open editor while the published source is temporarily incomplete', () => {
  render(<PublishedUserProfile contact={contact} />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }));
  act(() => source.next?.({ ...initial(), published: null, profile: null }));
  expect(screen.getByLabelText('Редактор переопределений')).toBeTruthy();
  expect(screen.getByText('Не удалось обновить анкету. Черновик сохранён в форме.')).toBeTruthy();
});

it('does not let an earlier visit close a newly opened editor for the same contact', async () => {
  let finish: ((data: ContactUserProfile) => void) | undefined;
  source.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<PublishedUserProfile contact={contact} />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }));
  fireEvent.click(screen.getByRole('button', { name: 'Записать имя' }));
  view.rerender(<PublishedUserProfile contact={{ ...contact, userId: 'tg:303', relationshipId: 'realm-2' }} />);
  view.rerender(<PublishedUserProfile contact={contact} />);
  fireEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }));
  expect(screen.getByLabelText('Редактор переопределений')).toBeTruthy();
  await act(async () => { finish?.(initial()); });
  expect(screen.getByLabelText('Редактор переопределений')).toBeTruthy();
  expect(screen.queryByText('Переопределения сохранены на устройстве.')).toBeNull();
});
