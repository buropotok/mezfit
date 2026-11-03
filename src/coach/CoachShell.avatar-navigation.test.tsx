// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import { CoachShell } from './CoachShell';

const client = {
  relationshipId: 'rlm' + 'a'.repeat(28),
  userId: 'tg:202',
  telegramUserId: '202',
  displayName: 'Andrei Sokolov',
  avatarVersion: null,
};

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {}, actorUserId: 'tg:101', clients: [client], coaches: [],
    status: 'ready', error: '', refresh: vi.fn(),
  }),
}));
vi.mock('../contacts/CloudContactAvatar', () => ({
  CloudContactAvatar: () => null,
  useCloudContactAvatarUrl: () => undefined,
}));
vi.mock('../contacts/CloudContactsList', () => ({
  CloudContactsList: () => <span>Список клиентов</span>,
}));
vi.mock('../profile/ProfileWorkspace', () => ({
  ProfileWorkspace: ({ tab, onTabChange }: {
    tab: string; onTabChange: (tab: 'basics' | 'program') => void;
  }) => <div>
    <span data-testid="active-client-tab">{tab}</span>
    <button onClick={() => onTabChange('program')}>Программа</button>
  </div>,
}));

afterEach(cleanup);

describe('coach avatar profile navigation', () => {
  it('opens the requested client on Basics, then returns there from the navbar avatar', async () => {
    const onContext = vi.fn<(context: NavigationContext | null) => void>();
    render(<CoachShell destination="clients" initData="verified"
      requestedAvatarClient={{ userId: client.userId, requestId: 1 }}
      onNavigationContextChange={onContext} />);

    await waitFor(() => expect(screen.getByTestId('active-client-tab').textContent).toBe('basics'));
    fireEvent.click(screen.getByRole('button', { name: 'Программа' }));
    expect(screen.getByTestId('active-client-tab').textContent).toBe('program');

    const context = onContext.mock.calls.map(([value]) => value)
      .findLast(value => value?.identity && 'avatar' in value.identity);
    expect(context?.identity).toEqual({
      title: client.displayName, avatar: { name: client.displayName, src: undefined },
    });
    act(() => context?.onIdentityClick?.());
    expect(screen.getByTestId('active-client-tab').textContent).toBe('basics');
  });

  it('ignores profile requests for users outside the connected client directory', () => {
    render(<CoachShell destination="clients" initData="verified"
      requestedAvatarClient={{ userId: 'tg:unknown', requestId: 1 }}
      onNavigationContextChange={vi.fn()} />);
    expect(screen.queryByTestId('active-client-tab')).toBeNull();
    expect(screen.getByText('Список клиентов')).toBeTruthy();
  });
});
