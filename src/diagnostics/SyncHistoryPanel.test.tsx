// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSyncHistory } from '../data/cloud/session-sync-history';
import { SyncHistoryPanel } from './SyncHistoryPanel';

const state = vi.hoisted(() => ({
  history: null as SessionSyncHistory | null,
}));

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ syncHistory: state.history }),
}));
vi.mock('../ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
    <button onClick={onClick}>{children}</button>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  GlassSurface: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
}));

let now: number;
beforeEach(() => {
  now = 100_000;
  state.history = new SessionSyncHistory('tg:101', null, () => now);
});
afterEach(() => { cleanup(); state.history = null; });

describe('Settings → Development technical history', () => {
  it('shows existing transitions in reverse order, updates live and clears only the diagnostic log', () => {
    state.history!.recordSync('pushing', 'connecting');
    now += 2_000;
    state.history!.recordWebSocket('connected');

    render(<SyncHistoryPanel />);
    const list = screen.getByRole('list', { name: 'События Dexie Cloud' });
    expect(list.textContent).toContain('Sync: pushing / connecting');
    expect(list.textContent).toContain('WebSocket: connected');
    expect(list.textContent?.indexOf('WebSocket: connected'))
      .toBeLessThan(list.textContent?.indexOf('Sync: pushing / connecting') ?? 9999);

    now += 1000;
    act(() => state.history!.recordSync('in-sync', 'offline'));
    expect(list.textContent).toContain('Sync: in-sync / offline');

    fireEvent.click(screen.getByRole('button', { name: 'Очистить историю' }));
    expect(screen.getByText('Событий за последний час нет.')).toBeTruthy();
    expect(state.history!.getSnapshot()).toHaveLength(0);
  });

  it('expires entries beyond the one-hour horizon on panel mount', () => {
    state.history!.recordWebSocket('connected');
    now += 60 * 60 * 1000 + 1;
    render(<SyncHistoryPanel />);
    expect(screen.getByText('Событий за последний час нет.')).toBeTruthy();
  });
});
