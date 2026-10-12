// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMe } from '../api';
import { createCloudDatabase, type MezfitCloudDatabase } from '../data/cloud/database';
import { CloudAuthDiagnostic } from './CloudAuthDiagnostic';
import { CloudSyncDiagnostic } from './CloudSyncDiagnostic';

vi.mock('../api', () => ({ getMe: vi.fn() }));
vi.mock('../data/cloud/database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('dexie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dexie')>();
  return { ...actual, liveQuery: vi.fn() };
});

const unsubscribe = vi.fn();
const observeSync = vi.fn((next: (state: { phase: string; status: string }) => void) => {
  next({ phase: 'pulling', status: 'connecting' });
  return { unsubscribe };
});
const observePersisted = vi.fn((next: (state: { timestamp: number } | undefined) => void) => {
  next({ timestamp: 1734000000000 });
  return { unsubscribe };
});
const observeUser = vi.fn((next: (user: { userId: string }) => void) => {
  next({ userId: 'tg:42' });
  return { unsubscribe };
});
const open = vi.fn(async () => undefined);
const close = vi.fn();
const sync = vi.fn(async () => undefined);
const database = {
  open, close,
  realms: { toArray: vi.fn(async () => []) },
  members: { toArray: vi.fn(async () => []) },
  cloud: {
    sync,
    syncState: { subscribe: observeSync },
    persistedSyncState: { subscribe: observePersisted },
    currentUser: { subscribe: observeUser },
  },
} as unknown as MezfitCloudDatabase;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMe).mockResolvedValue({
    user: { telegramUserId: '42' },
  } as Awaited<ReturnType<typeof getMe>>);
  vi.mocked(createCloudDatabase).mockReturnValue(database);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe: (observer: { next: (counts: object) => void }) => {
      observer.next({
        realms: 1, members: 2, ownMembers: 1,
        coaches: 0, clients: 1, readError: false,
      });
      return { unsubscribe };
    },
  } as unknown as ReturnType<typeof liveQuery>);
});

afterEach(() => {
  cleanup();
  delete window.Telegram;
});

describe('read-only cloud sync diagnostic', () => {
  it('reports addon state and only aggregate local counts, without identifiers or secrets', async () => {
    render(<CloudSyncDiagnostic initData="signed-secret-init-data" />);
    await waitFor(() => expect(screen.getByText('Этап: observing')).toBeTruthy());
    expect(getMe).toHaveBeenCalledWith('signed-secret-init-data');
    expect(createCloudDatabase).toHaveBeenCalledWith('42', 'signed-secret-init-data');
    expect(open).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledWith({ purpose: 'pull', wait: false });
    expect(screen.getByText('Dexie: pulling / connecting')).toBeTruthy();
    expect(screen.getByText('Облачный пользователь подтверждён: да')).toBeTruthy();
    expect(screen.getByText('Локальные realms: 1')).toBeTruthy();
    expect(screen.getByText('Локальные members: 2')).toBeTruthy();
    expect(screen.getByText('Мои membership: 1')).toBeTruthy();
    expect(screen.getByText('Подтверждённые связи: тренеры 0, клиенты 1')).toBeTruthy();
    expect(document.body.textContent).not.toContain('signed-secret-init-data');
    expect(document.body.textContent).not.toContain('tg:42');
  });

  it('does not leak raw Worker error bodies when identity lookup fails', async () => {
    vi.mocked(getMe).mockRejectedValue(new Error('Bearer secret-value'));
    render(<CloudSyncDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByText('Этап: failed')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Диагностика обнаружила ошибку');
    expect(document.body.textContent).not.toContain('secret-value');
    expect(createCloudDatabase).not.toHaveBeenCalled();
  });

  it('unsubscribes from addon observables and closes the database when leaving diagnostic screen', async () => {
    const view = render(<CloudSyncDiagnostic initData="signed" />);
    await waitFor(() => expect(screen.getByText('Этап: observing')).toBeTruthy());
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(4);
    expect(close).toHaveBeenCalledWith({ disableAutoOpen: false });
  });

  it('opens the new diagnostic only after an explicit tap from the existing Telegram check', async () => {
    window.Telegram = {
      WebApp: {
        initData: 'signed',
        colorScheme: 'dark',
        ready: vi.fn(),
        expand: vi.fn(),
      },
    };
    render(<CloudAuthDiagnostic />);
    expect(createCloudDatabase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить синхронизацию' }));
    await waitFor(() => expect(screen.getByText('Этап: observing')).toBeTruthy());
    expect(createCloudDatabase).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть диагностику синхронизации' }));
    expect(close).toHaveBeenCalledWith({ disableAutoOpen: false });
  });
});
