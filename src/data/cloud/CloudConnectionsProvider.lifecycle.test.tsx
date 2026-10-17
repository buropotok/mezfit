// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { liveQuery } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDatabase, type MezfitCloudDatabase } from './database';
import { CloudConnectionsProvider } from './CloudConnectionsProvider';

vi.mock('./program-sync', () => ({
  observeProgramSyncConfirmation: vi.fn(() => () => {}),
  confirmProgramSync: vi.fn(async () => {}),
}));
vi.mock('./database', () => ({ createCloudDatabase: vi.fn() }));
vi.mock('dexie', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dexie')>();
  return { ...actual, liveQuery: vi.fn() };
});

const close = vi.fn();
const unsubscribe = vi.fn();
const subscribe = vi.fn(() => ({ unsubscribe }));
const database = {
  close,
  realms: { toArray: vi.fn(async () => []) },
  members: { toArray: vi.fn(async () => []) },
  cloud: { sync: vi.fn(async () => undefined) },
} as unknown as MezfitCloudDatabase;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCloudDatabase).mockReturnValue(database);
  vi.mocked(liveQuery).mockReturnValue({ subscribe } as unknown as ReturnType<typeof liveQuery>);
});

afterEach(cleanup);

describe('CloudConnectionsProvider StrictMode lifecycle', () => {
  it('can resubscribe with its memoized Dexie 4 instance after effect cleanup', () => {
    const view = render(
      <StrictMode>
        <CloudConnectionsProvider telegramUserId="101" initData="signed">
          <span>Directory</span>
        </CloudConnectionsProvider>
      </StrictMode>,
    );

    // React 19 StrictMode runs setup, cleanup and setup on the same component.
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenNthCalledWith(1, { disableAutoOpen: false });
    expect(view.getByText('Directory')).toBeTruthy();

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenNthCalledWith(2, { disableAutoOpen: false });
  });
});
