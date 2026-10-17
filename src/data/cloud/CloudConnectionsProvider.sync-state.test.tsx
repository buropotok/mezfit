// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';
import { useSyncNotificationBudget } from './sync-notification-budget';
import {
  CloudConnectionsProvider, projectCloudSyncState, useCloudConnections,
  type CloudContact,
} from './CloudConnectionsProvider';

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
type Snapshot = {
  contacts: { clients: CloudContact[]; coaches: CloudContact[] };
  hasRelationshipMembership: boolean;
};

let emitSync: ((value: SyncState) => void) | undefined;
let emitContacts: ((value: Snapshot) => void) | undefined;
let retrySync: (() => Promise<void>) | undefined;
const unsubscribeSync = vi.fn();
const unsubscribeContacts = vi.fn();
const sync = vi.fn(async () => undefined);

function Status() {
  const cloud = useCloudConnections();
  retrySync = cloud?.retrySync;
  return (
    <div data-testid="sync-status">
      {cloud?.status}|{cloud?.syncStatus}|{cloud?.syncError}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  emitSync = undefined;
  emitContacts = undefined;
  retrySync = undefined;
  const database = {
    close: vi.fn(),
    realms: { toArray: vi.fn(async () => []) },
    members: { toArray: vi.fn(async () => []) },
    contactProfiles: { toArray: vi.fn(async () => []) },
    cloud: {
      sync,
      syncState: {
        subscribe(observer: { next: (state: SyncState) => void }) {
          emitSync = observer.next;
          observer.next({ status: 'not-started', phase: 'initial' });
          return { unsubscribe: unsubscribeSync };
        },
      },
    },
  } as unknown as MezfitCloudDatabase;
  vi.mocked(createCloudDatabase).mockReturnValue(database);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe(observer: { next: (value: Snapshot) => void }) {
      emitContacts = observer.next;
      return { unsubscribe: unsubscribeContacts };
    },
  } as unknown as ReturnType<typeof liveQuery>);
});

afterEach(cleanup);

describe('real Dexie Cloud PLAN sync state', () => {
  it('resets the global notification budget only on confirmed synchronization', async () => {
    let budget: ReturnType<typeof useSyncNotificationBudget>;
    function Budget() { budget = useSyncNotificationBudget(); return null; }
    render(<CloudConnectionsProvider telegramUserId="101" initData="signed"><Status /><Budget /></CloudConnectionsProvider>);
    expect(budget!.claim()).toBe(true);
    expect(budget!.claim()).toBe(true);
    expect(budget!.claim()).toBe(true);
    expect(budget!.claim()).toBe(false);
    act(() => emitSync?.({ phase: 'error', status: 'error' }));
    await act(async () => { await retrySync?.(); });
    expect(budget!.claim()).toBe(false);
    act(() => emitSync?.({ phase: 'in-sync', status: 'disconnected' }));
    expect(budget!.claim()).toBe(false);
    act(() => emitSync?.({ phase: 'in-sync', status: 'connected' }));
    expect(budget!.claim()).toBe(true);
  });
  it('distinguishes pending, disconnected, rejected and confirmed uploads', () => {
    expect(projectCloudSyncState({ phase: 'pushing', status: 'connected' }).status).toBe('pending');
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'disconnected' }).status).toBe('pending');
    expect(projectCloudSyncState({ phase: 'offline', status: 'offline' }).status).toBe('offline');
    expect(projectCloudSyncState({
      phase: 'error', status: 'error', error: new Error('PLAN_WRITE_DENIED'),
    })).toEqual({ status: 'error', error: 'PLAN_WRITE_DENIED' });
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'connected' }).status).toBe('synced');
  });

  it('keeps cached contacts ready while PLAN sync goes offline or errors, and retries push before pull', async () => {
    const view = render(
      <CloudConnectionsProvider telegramUserId="101" initData="signed">
        <Status />
      </CloudConnectionsProvider>,
    );

    const cached: CloudContact = {
      relationshipId: 'rlm-pair', userId: 'tg:202',
      telegramUserId: '202', displayName: 'Тренер',
    };
    act(() => emitContacts?.({
      contacts: { clients: [], coaches: [cached] }, hasRelationshipMembership: true,
    }));
    await waitFor(() => expect(screen.getByTestId('sync-status').textContent).toContain('ready|pending|'));

    act(() => emitSync?.({ phase: 'offline', status: 'offline' }));
    expect(screen.getByTestId('sync-status').textContent).toContain('ready|offline|');

    act(() => emitSync?.({
      phase: 'error', status: 'error', error: new Error('PLAN_WRITE_DENIED'),
    }));
    expect(screen.getByTestId('sync-status').textContent).toContain('ready|error|PLAN_WRITE_DENIED');

    sync.mockClear();
    await act(async () => { await retrySync?.(); });
    expect(sync).toHaveBeenNthCalledWith(1, { purpose: 'push', wait: true });
    expect(sync).toHaveBeenNthCalledWith(2, { purpose: 'pull', wait: true });
    // A successful retry call alone does not promise cloud persistence.
    expect(screen.getByTestId('sync-status').textContent).toContain('ready|pending|');
    act(() => emitSync?.({ phase: 'in-sync', status: 'connected' }));
    expect(screen.getByTestId('sync-status').textContent).toContain('ready|synced|');

    view.unmount();
    expect(unsubscribeSync).toHaveBeenCalledTimes(1);
    expect(unsubscribeContacts).toHaveBeenCalledTimes(1);
  });
});
