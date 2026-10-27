// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';
import { CloudConnectionsProvider, useCloudConnections } from './CloudConnectionsProvider';
import type { SessionSyncHistory } from './session-sync-history';

vi.mock('./workout-sync', () => ({ observeWorkoutSyncConfirmation: vi.fn(() => () => {}) }));
vi.mock('./program-sync', () => ({
  observeProgramSyncConfirmation: vi.fn(() => () => {}),
  confirmProgramSync: vi.fn(async () => {}),
}));
vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('../../api', () => ({ syncCloudContactProfile: vi.fn(async () => false) }));
vi.mock('dexie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dexie')>();
  return { ...actual, liveQuery: vi.fn() };
});

type SyncState = MezfitCloudDatabase['cloud']['syncState']['value'];
let sendSync: ((value: SyncState) => void) | undefined;
let sendSocket: ((status: string) => void) | undefined;
let history: SessionSyncHistory | undefined;
const syncUnsubscribe = vi.fn();
const socketUnsubscribe = vi.fn();

function Capture() {
  history = useCloudConnections()?.syncHistory;
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.removeItem('mezfit:dev-sync-history:v1:tg:404');
  history = undefined;
  sendSync = undefined;
  sendSocket = undefined;
  const database = {
    close: vi.fn(),
    realms: { toArray: vi.fn(async () => []) },
    members: { toArray: vi.fn(async () => []) },
    contactProfiles: { toArray: vi.fn(async () => []) },
    cloud: {
      sync: vi.fn(async () => {}),
      syncState: {
        subscribe(observer: { next: (state: SyncState) => void }) {
          sendSync = observer.next;
          observer.next({ phase: 'initial', status: 'not-started' });
          return { unsubscribe: syncUnsubscribe };
        },
      },
      webSocketStatus: {
        subscribe(next: (status: string) => void) {
          sendSocket = next;
          next('not-started');
          return { unsubscribe: socketUnsubscribe };
        },
      },
    },
  } as unknown as MezfitCloudDatabase;
  vi.mocked(createCloudDatabase).mockReturnValue(database);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe: () => ({ unsubscribe: vi.fn() }),
  } as unknown as ReturnType<typeof liveQuery>);
});

afterEach(() => {
  cleanup();
  window.sessionStorage.removeItem('mezfit:dev-sync-history:v1:tg:404');
});

it('collects SDK and WebSocket changes while Settings is closed and unsubscribes with the cloud provider', () => {
  const view = render(<CloudConnectionsProvider telegramUserId="404" initData="signed">
    <Capture />
  </CloudConnectionsProvider>);
  expect(history?.getSnapshot()).toHaveLength(2);
  act(() => {
    sendSync?.({ phase: 'pushing', status: 'connected' });
    sendSocket?.('connected');
    sendSync?.({ phase: 'in-sync', status: 'offline', error: new Error('PRIVATE_AUTH_ERROR_BODY') });
  });
  expect(history?.getSnapshot()).toMatchObject([
    { source: 'sync', phase: 'initial', status: 'not-started' },
    { source: 'websocket', status: 'not-started' },
    { source: 'sync', phase: 'pushing', status: 'connected' },
    { source: 'websocket', status: 'connected' },
    { source: 'sync', phase: 'in-sync', status: 'offline' },
  ]);
  const cached = window.sessionStorage.getItem('mezfit:dev-sync-history:v1:tg:404');
  expect(cached).toContain('offline');
  expect(cached).not.toContain('PRIVATE_AUTH_ERROR_BODY');
  view.unmount();
  expect(syncUnsubscribe).toHaveBeenCalledTimes(1);
  expect(socketUnsubscribe).toHaveBeenCalledTimes(1);
});
