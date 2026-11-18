// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';
import type { NavigationContext } from '../NavigationShell';
import { resetTestClientRelationship } from '../api';

vi.mock('../api', async original => ({
  ...(await original<typeof import('../api')>()),
  resetTestClientRelationship: vi.fn(),
}));
vi.mock('../profile/PublishedUserProfile', () => ({
  PublishedUserProfile: () => <div>Анкета клиента</div>,
}));
vi.mock('../schedule/TodayPage', () => ({ TodayPage: () => <div>Сегодня</div> }));

const client = { relationshipId: 'rlm-test', userId: 'tg:202', telegramUserId: '202', displayName: 'Тестовый клиент' };
const cloud = { status: 'ready', error: '', clients: [client], refresh: vi.fn(async () => undefined) };
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => cloud }));

beforeEach(() => {
  vi.mocked(resetTestClientRelationship).mockReset();
  cloud.clients = [client];
  cloud.refresh.mockReset();
  cloud.refresh.mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function openProfile() {
  const onNavigationContextChange = vi.fn<(context: NavigationContext | null) => void>();
  render(<CoachShell initData="telegram-init" destination="clients" onNavigationContextChange={onNavigationContextChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть клиента Тестовый клиент' }));
  // Workouts is the default tab now. The navbar profile identity opens Basics for administration.
  const profileContext = onNavigationContextChange.mock.calls.map(([value]) => value)
    .reverse().find(value => value?.onIdentityClick);
  if (!profileContext?.onIdentityClick) throw new Error('Missing client profile identity action');
  act(() => profileContext.onIdentityClick?.());
}

describe('Coach test link reset confirmation', () => {
  it('requires explicit confirmation and uses the signed API', async () => {
    openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить тестовую связь' }));
    expect(screen.getByText(/безвозвратно удалены/)).toBeTruthy();
    fireEvent.click(screen.getByText('Отмена'));
    expect(resetTestClientRelationship).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить тестовую связь' }));
    fireEvent.click(screen.getByRole('button', { name: /^Сбросить$/ }));
    await waitFor(() => expect(resetTestClientRelationship).toHaveBeenCalledWith('telegram-init', '202'));
    await waitFor(() => expect(cloud.refresh).toHaveBeenCalledTimes(1));
  });

  it('preserves the selected client and shows a retryable error when reset fails', async () => {
    vi.mocked(resetTestClientRelationship).mockRejectedValueOnce(new Error('Сброс временно недоступен'));
    openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить тестовую связь' }));
    fireEvent.click(screen.getByRole('button', { name: /^Сбросить$/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Сброс временно недоступен'));
    expect(cloud.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Сбросить тестовую связь' })).toBeTruthy();
  });
});
