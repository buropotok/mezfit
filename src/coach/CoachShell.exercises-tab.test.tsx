// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

const client = { userId: 'tg:202', relationshipId: 'realm-202', telegramUserId: '202', displayName: 'Анна Иванова' };
const renderExercises = vi.hoisted(() => vi.fn());

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {}, actorUserId: 'tg:101', status: 'ready', clients: [client],
    error: '', syncStatus: 'synced', syncError: '',
    refresh: vi.fn(async () => {}), retrySync: vi.fn(async () => {}),
  }),
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: readonly { value: string; label: string }[];
    value: string;
    onValueChange: (next: string) => void;
  }) => <div role="tablist">{tabs.map(tab => (
    <button key={tab.value} role="tab" aria-selected={value === tab.value}
      onClick={() => onValueChange(tab.value)}>{tab.label}</button>
  ))}</div>,
}));
vi.mock('./ClientPerformedExercisesPage', () => ({
  ClientPerformedExercisesPage: ({ client: current }: { client: typeof client }) => {
    renderExercises(current);
    return <section aria-label="История упражнений клиента">{current.userId}</section>;
  },
}));

beforeEach(() => {
  renderExercises.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Coach client Exercises tab', () => {
  it('shows the selected client exercise history only on the Exercises tab', async () => {
    render(<CoachShell initData="verified" destination="clients" onNavigationContextChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть клиента Анна Иванова' }));
    expect(screen.queryByRole('region', { name: 'История упражнений клиента' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Упражнения' }));
    expect(screen.getByRole('region', { name: 'История упражнений клиента' }).textContent).toBe(client.userId);
    expect(renderExercises).toHaveBeenCalledWith(client);
    expect(screen.queryByText('Каталог упражнений клиента будет доступен после перевода этого раздела на Dexie Cloud.')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    expect(screen.queryByRole('region', { name: 'История упражнений клиента' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Упражнения' }));
    expect(screen.getByRole('region', { name: 'История упражнений клиента' })).toBeTruthy();
  });
});
