// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isApprovedAssignedPair } from './assigned-programs';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';
import { CloudConnectionsProvider, useCloudConnections, type CloudContact } from './CloudConnectionsProvider';

vi.mock('./program-sync', () => ({
  observeProgramSyncConfirmation: vi.fn(() => () => {}),
  confirmProgramSync: vi.fn(async () => {}),
}));
vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('./assigned-programs', () => ({ isApprovedAssignedPair: vi.fn() }));
vi.mock('dexie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dexie')>();
  return { ...actual, liveQuery: vi.fn() };
});

type Snapshot = {
  contacts: { clients: CloudContact[]; coaches: CloudContact[] };
  hasRelationshipMembership: boolean;
};

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const realmId = 'rlm-linked';
const realm = { realmId, name: 'Mezfit coach-client pilot', owner: null };
const members = [
  { id: 'mmb-coach', realmId, userId: 'tg:101', roles: ['coach'], accepted: new Date(), owner: null },
  { id: 'mmb-client', realmId, userId: 'tg:202', name: 'Клиент', roles: ['client'], accepted: new Date(), owner: null },
];

let realmRows: typeof realm[] = [];
let memberRows: typeof members = [];
let pull: ReturnType<typeof deferred>;
let sendLocal: ((value: Snapshot) => void) | undefined;
let cloudDb: MezfitCloudDatabase;
let refreshContacts: (() => Promise<void>) | undefined;
const unsubscribe = vi.fn();

function Status() {
  const cloud = useCloudConnections();
  refreshContacts = cloud?.refresh;
  return <div data-testid="contacts">{cloud?.status}:{cloud?.clients.map((client) => client.displayName).join(',')}:{cloud?.error}</div>;
}

function mount() {
  return render(<CloudConnectionsProvider telegramUserId="101" initData="signed"><Status /></CloudConnectionsProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  pull = deferred();
  realmRows = [];
  memberRows = [];
  sendLocal = undefined;
  refreshContacts = undefined;
  cloudDb = {
    close: vi.fn(),
    cloud: { sync: vi.fn(() => pull.promise) },
    realms: { toArray: vi.fn(async () => realmRows) },
    members: { toArray: vi.fn(async () => memberRows) },
  } as unknown as MezfitCloudDatabase;
  vi.mocked(createCloudDatabase).mockReturnValue(cloudDb);
  vi.mocked(isApprovedAssignedPair).mockResolvedValue(true);
  vi.mocked(liveQuery).mockReturnValue({
    subscribe(observer: { next: (value: Snapshot) => void }) {
      sendLocal = observer.next;
      return { unsubscribe };
    },
  } as unknown as ReturnType<typeof liveQuery>);
});

afterEach(cleanup);

describe('cloud relationship initial hydration', () => {
  it('does not claim no contacts until cloud pull confirms the first result', async () => {
    mount();
    act(() => sendLocal?.({ contacts: { clients: [], coaches: [] }, hasRelationshipMembership: false }));
    expect(screen.getByTestId('contacts').textContent).toBe('loading::');
    await waitFor(() => expect(cloudDb.cloud.sync).toHaveBeenCalledWith({ purpose: 'pull', wait: true }));
    expect(vi.mocked(cloudDb.realms.toArray).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(cloudDb.cloud.sync).mock.invocationCallOrder[0]);

    realmRows = [realm];
    memberRows = members;
    await act(async () => { pull.resolve(); await pull.promise; });

    await waitFor(() => expect(screen.getByTestId('contacts').textContent).toBe('ready:Клиент:'));
  });

  it('reports failed initial synchronization instead of showing a false empty directory', async () => {
    mount();
    act(() => sendLocal?.({ contacts: { clients: [], coaches: [] }, hasRelationshipMembership: false }));
    await act(async () => { pull.reject(new Error('NETWORK_DOWN')); await pull.promise.catch(() => undefined); });
    expect(screen.getByTestId('contacts').textContent).toContain('error:');
    expect(screen.getByTestId('contacts').textContent).toContain('Не удалось синхронизировать связи');
    // Unrelated local-table changes must not convert a failed cloud sync to "no trainers".
    act(() => sendLocal?.({ contacts: { clients: [], coaches: [] }, hasRelationshipMembership: false }));
    expect(screen.getByTestId('contacts').textContent).toContain('error:');
  });

  it('keeps previously synced contacts visible when the remote pull fails offline', async () => {
    mount();
    const cached: CloudContact = {
      relationshipId: realmId, userId: 'tg:202', telegramUserId: '202', displayName: 'Клиент',
    };
    act(() => sendLocal?.({
      contacts: { clients: [cached], coaches: [] }, hasRelationshipMembership: true,
    }));
    expect(screen.getByTestId('contacts').textContent).toBe('ready:Клиент:');
    await act(async () => { pull.reject(new Error('OFFLINE')); await pull.promise.catch(() => undefined); });
    expect(screen.getByTestId('contacts').textContent).toBe('ready:Клиент:');
  });

  it('reports downloaded memberships that fail the canonical relationship check', async () => {
    vi.mocked(isApprovedAssignedPair).mockResolvedValue(false);
    mount();
    realmRows = [realm];
    memberRows = members;
    await act(async () => { pull.resolve(); await pull.promise; });
    await waitFor(() => expect(screen.getByTestId('contacts').textContent).toContain('не прошла проверку'));
    expect(screen.getByTestId('contacts').textContent).toContain('error:');
  });

  it('allows an empty update after a successful retry following initial pull failure', async () => {
    mount();
    await waitFor(() => expect(cloudDb.cloud.sync).toHaveBeenCalledTimes(1));
    await act(async () => { pull.reject(new Error('OFFLINE')); await pull.promise.catch(() => undefined); });
    expect(screen.getByTestId('contacts').textContent).toContain('error:');

    pull = deferred();
    realmRows = [realm];
    memberRows = members;
    await act(async () => {
      const retry = refreshContacts?.();
      expect(retry).toBeDefined();
      pull.resolve();
      await retry;
    });
    expect(screen.getByTestId('contacts').textContent).toBe('ready:Клиент:');

    // Once hydration was recovered, liveQuery must be allowed to remove the last contact.
    act(() => sendLocal?.({
      contacts: { clients: [], coaches: [] }, hasRelationshipMembership: false,
    }));
    expect(screen.getByTestId('contacts').textContent).toBe('ready::');
  });

  it('shows a genuinely empty directory after successful pull with no membership', async () => {
    mount();
    await act(async () => { pull.resolve(); await pull.promise; });
    await waitFor(() => expect(screen.getByTestId('contacts').textContent).toBe('ready::'));
  });
});
