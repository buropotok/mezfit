// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../../api', () => ({ syncCloudContactProfile: vi.fn(async () => false) }));
vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('dexie', async (importOriginal) => {
  const original = await importOriginal<typeof import('dexie')>();
  return { ...original, liveQuery: vi.fn() };
});

let progressChanged: ((value: { blobsRemaining: number }) => void) | undefined;
const unsubscribe = vi.fn();

function AvatarRevision() {
  return <span data-testid="revision">{useCloudConnections()?.avatarLoadRevision}</span>;
}

beforeEach(() => {
  vi.clearAllMocks();
  progressChanged = undefined;
  const database = {
    realms: { toArray: vi.fn(async () => []) },
    members: { toArray: vi.fn(async () => []) },
    contactProfiles: { toArray: vi.fn(async () => []) },
    close: vi.fn(),
    cloud: {
      sync: vi.fn(async () => undefined),
      blobProgress: {
        subscribe: vi.fn((observer: { next(value: { blobsRemaining: number }): void }) => {
          progressChanged = (value) => observer.next(value);
          return { unsubscribe };
        }),
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
  vi.restoreAllMocks();
});

describe('remote blob download completion', () => {
  it('retries previously unresolved avatar content only when download progress advances', async () => {
    const view = render(
      <CloudConnectionsProvider telegramUserId="101" initData="verified">
        <AvatarRevision />
      </CloudConnectionsProvider>,
    );
    await waitFor(() => expect(progressChanged).toBeDefined());
    expect(screen.getByTestId('revision').textContent).toBe('0');
    act(() => progressChanged?.({ blobsRemaining: 2 }));
    expect(screen.getByTestId('revision').textContent).toBe('0');
    act(() => progressChanged?.({ blobsRemaining: 1 }));
    expect(screen.getByTestId('revision').textContent).toBe('1');
    act(() => progressChanged?.({ blobsRemaining: 0 }));
    expect(screen.getByTestId('revision').textContent).toBe('2');
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('re-checks the owner avatar on returning to the Mini App without polling while visible', async () => {
    const view = render(
      <CloudConnectionsProvider telegramUserId="101" initData="verified">
        <AvatarRevision />
      </CloudConnectionsProvider>,
    );
    await waitFor(() => expect(syncCloudContactProfile).toHaveBeenCalledTimes(1));

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(syncCloudContactProfile).toHaveBeenCalledTimes(2));

    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(syncCloudContactProfile).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('queues a return refresh if the startup profile request has not finished', async () => {
    let finishStartup: ((value: boolean) => void) | undefined;
    const startup = new Promise<boolean>(resolve => { finishStartup = resolve; });
    vi.mocked(syncCloudContactProfile).mockImplementationOnce(() => startup);
    const view = render(
      <CloudConnectionsProvider telegramUserId="101" initData="verified">
        <AvatarRevision />
      </CloudConnectionsProvider>,
    );
    await waitFor(() => expect(syncCloudContactProfile).toHaveBeenCalledTimes(1));

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(syncCloudContactProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishStartup?.(false);
      await startup;
    });
    await waitFor(() => expect(syncCloudContactProfile).toHaveBeenCalledTimes(2));
    view.unmount();
  });

});
