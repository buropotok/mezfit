// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import type { UserProfile } from '../data/cloud/user-profile';
import { PublishedUserProfile } from './PublishedUserProfile';

const source = vi.hoisted(() => ({
  db: {}, requested: vi.fn(), next: null as ((profile: UserProfile | null) => void) | null,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: source.db, actorUserId: 'tg:101' }),
}));
vi.mock('../data/cloud/user-profile', async importOriginal => {
  const original = await importOriginal<typeof import('../data/cloud/user-profile')>();
  return { ...original, UserProfileRepository: class {
    observePublished(userId: string, realmId: string, next: (profile: UserProfile | null) => void) {
      source.requested(userId, realmId); source.next = next; next(null);
      return { unsubscribe() {} };
    }
  } };
});
vi.mock('../ui', () => ({
  GlassSurface: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Text: ({ children, variant }: { children: ReactNode; variant: string }) => <span data-variant={variant}>{children}</span>,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));
afterEach(() => { cleanup(); source.requested.mockClear(); source.next = null; });
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
