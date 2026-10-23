// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

const client = {
  relationshipId: 'rlm' + 'a'.repeat(28),
  userId: 'tg:202',
  telegramUserId: '202',
  displayName: 'Andrei Sokolov',
  avatarVersion: 'b'.repeat(64),
};

let navbarAvatarUrl: string | undefined;
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {}, actorUserId: 'tg:101', clients: [client], coaches: [],
    status: 'ready', error: '', refresh: vi.fn(),
  }),
}));
vi.mock('../contacts/CloudContactAvatar', () => ({
  CloudContactAvatar: () => null,
  useCloudContactAvatarUrl: (contact: unknown) => contact ? navbarAvatarUrl : undefined,
}));
vi.mock('../contacts/CloudContactsList', () => ({
  CloudContactsList: ({ contacts, onSelect }: {
    contacts: typeof client[];
    onSelect: (contact: typeof client) => void;
  }) => <button onClick={() => onSelect(contacts[0])}>Выбрать клиента</button>,
}));

beforeEach(() => { navbarAvatarUrl = undefined; });
afterEach(cleanup);

describe('coach client navbar identity', () => {
  it('receives the small cloud avatar URL when the image finishes loading', async () => {
    const onNavigationContextChange = vi.fn();
    const view = render(<CoachShell
      destination="clients" initData="verified"
      onNavigationContextChange={onNavigationContextChange}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать клиента' }));
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { title: client.displayName, avatar: { name: client.displayName, src: undefined } },
      }),
    ));

    navbarAvatarUrl = 'blob:mezfit-portrait';
    view.rerender(<CoachShell destination="clients" initData="verified"
      onNavigationContextChange={onNavigationContextChange} />);
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { title: client.displayName, avatar: { name: client.displayName, src: 'blob:mezfit-portrait' } },
      }),
    ));
  });
});
