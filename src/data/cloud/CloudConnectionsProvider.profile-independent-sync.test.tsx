// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncCloudContactProfile } from '../../api';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';
import { CloudConnectionsProvider, useCloudConnections } from './CloudConnectionsProvider';

vi.mock('./workout-sync', () => ({ observeWorkoutSyncConfirmation: vi.fn(() => () => {}) }));
vi.mock('./program-sync', () => ({
  observeProgramSyncConfirmation: vi.fn(() => () => {}),
  confirmProgramSync: vi.fn(async () => {}),
}));
vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('../../api', () => ({ syncCloudContactProfile: vi.fn() }));
vi.mock('dexie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dexie')>();
  return { ...actual, liveQuery: vi.fn() };
});

let refreshContacts: (() => Promise<void>) | null = null;
let cloudDb: MezfitCloudDatabase;
const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function Consumer() {
  refreshContacts = useCloudConnections()?.refresh ?? null;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshContacts = null;
  // Simulate an avatar request that never resolves: contacts must still sync.
  vi.mocked(syncCloudContactProfile).mockImplementation(() => new Promise<boolean>(() => {}));
  cloudDb = {
    close: vi.fn(),
    realms: { toArray: vi.fn(async () => []) },
    members: { toArray: vi.fn(async () => []) },
    cloud: { sync: vi.fn(async () => {}) },
  } as unknown as MezfitCloudDatabase;
  vi.mocked(createCloudDatabase).mockReturnValue(cloudDb);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe: () => ({ unsubscribe: vi.fn() }),
  } as unknown as ReturnType<typeof liveQuery>);
});

afterEach(() => {
  cleanup();
  if (originalVisibilityDescriptor) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
  } else {
    Reflect.deleteProperty(document, 'visibilityState');
  }
});

function mount() {
  render(<CloudConnectionsProvider telegramUserId="101" initData="signed"><Consumer /></CloudConnectionsProvider>);
}

describe('relationship sync independent of Telegram profile', () => {
  it('pulls contacts immediately when refreshed, even if the avatar request is still pending', async () => {
    mount();
    await waitFor(() => expect(cloudDb.cloud.sync).toHaveBeenCalledTimes(1));
    expect(syncCloudContactProfile).toHaveBeenCalledTimes(1);

    await act(async () => { await refreshContacts?.(); });

    expect(cloudDb.cloud.sync).toHaveBeenCalledTimes(2);
    expect(cloudDb.cloud.sync).toHaveBeenLastCalledWith({ purpose: 'pull', wait: true });
    expect(syncCloudContactProfile).toHaveBeenCalledTimes(1);
  });

  it('pulls on Mini App resume without waiting for the pending avatar request', async () => {
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    mount();
    await waitFor(() => expect(cloudDb.cloud.sync).toHaveBeenCalledTimes(1));

    act(() => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(cloudDb.cloud.sync).toHaveBeenCalledTimes(2));
    expect(cloudDb.cloud.sync).toHaveBeenLastCalledWith({ purpose: 'pull', wait: false });
  });
});
