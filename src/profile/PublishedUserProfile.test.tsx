// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import type { ContactUserProfile, UserProfile } from '../data/cloud/user-profile';
import { PublishedUserProfile } from './PublishedUserProfile';

const source = vi.hoisted(() => ({
  db: {}, available: true, emitInitial: true, constructed: vi.fn(), requested: vi.fn(), next: null as ((profile: UserProfile | null) => void) | null,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: source.available ? source.db : undefined,
    actorUserId: source.available ? 'tg:101' : undefined }),
}));
vi.mock('../data/cloud/user-profile', async importOriginal => {
  const original = await importOriginal<typeof import('../data/cloud/user-profile')>();
  return { ...original, UserProfileRepository: class {
    constructor(_db: unknown, actorUserId: string) { source.constructed(actorUserId); }
    observeContact(userId: string, realmId: string, next: (profile: ContactUserProfile) => void) {
      const emit = (profile: UserProfile | null) => next({ published: profile, profile,
        overridden: [], canEdit: false, incomplete: false });
      source.requested(userId, realmId); source.next = emit;
      if (source.emitInitial) emit(null);
      return { unsubscribe() {} };
    }
  } };
});
vi.mock('../ui', () => ({
  GlassSurface: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Text: ({ children, variant }: { children: ReactNode; variant: string }) => <span data-variant={variant}>{children}</span>,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
afterEach(() => { cleanup(); source.requested.mockClear(); source.constructed.mockClear(); source.available = true; source.emitInitial = true; source.db = {}; source.next = null; });
it('reads only the supplied relationship projection and renders published defaults without an editor', () => {
  const contact: CloudContact = { relationshipId: 'shared-relationship', userId: 'tg:202',
    telegramUserId: '202', displayName: 'Анна' };
  render(<PublishedUserProfile contact={contact} />);
  expect(source.requested).toHaveBeenCalledWith('tg:202', 'shared-relationship');
  expect(screen.getByText('Анкета клиента ещё не опубликована.')).toBeTruthy();
  act(() => source.next?.({ firstName: 'Опубликованное имя', lastName: '', email: '', phone: '',
    birthDate: '', sex: 'female', weightKg: null, updatedAt: '2026-11-02T00:00:00Z' }));
  expect(screen.getByText('Опубликованное имя').getAttribute('data-variant')).toBe('body');
  expect(screen.getByText('Пол').getAttribute('data-variant')).toBe('headline');
  expect(screen.getByText('жен').getAttribute('data-variant')).toBe('body');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Сохранить анкету')).toBeNull();
});

it('keeps the contact screen available when profile storage or identity is not ready', () => {
  source.available = false;
  const contact: CloudContact = { relationshipId: 'shared-relationship', userId: 'tg:202',
    telegramUserId: '202', displayName: 'Анна' };
  render(<PublishedUserProfile contact={contact} />);
  expect(screen.getByText('Анкета пока недоступна.')).toBeTruthy();
  expect(source.constructed).not.toHaveBeenCalled();
  expect(source.requested).not.toHaveBeenCalled();
});

it('discards the previous database snapshot before the replacement source responds', () => {
  const contact: CloudContact = { relationshipId: 'shared-relationship', userId: 'tg:202',
    telegramUserId: '202', displayName: 'Анна' };
  const view = render(<PublishedUserProfile contact={contact} />);
  const oldNext = source.next;
  const profile: UserProfile = { firstName: 'Старый снимок', lastName: '', email: '', phone: '',
    birthDate: '', sex: 'undisclosed', weightKg: null, updatedAt: '2026-11-02T00:00:00Z' };
  act(() => oldNext?.(profile));
  expect(screen.getByText('Старый снимок')).toBeTruthy();
  source.db = {}; source.emitInitial = false;
  view.rerender(<PublishedUserProfile contact={contact} />);
  expect(screen.getByText('Загрузка анкеты…')).toBeTruthy();
  expect(screen.queryByText('Старый снимок')).toBeNull();
  act(() => oldNext?.(profile));
  expect(screen.queryByText('Старый снимок')).toBeNull();
  act(() => source.next?.({ ...profile, firstName: 'Новый снимок' }));
  expect(screen.getByText('Новый снимок')).toBeTruthy();
});
