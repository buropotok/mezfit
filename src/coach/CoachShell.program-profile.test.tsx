// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CoachShell } from './CoachShell';

const client = {
  userId: 'tg:202', relationshipId: 'realm-202',
  telegramUserId: '202', displayName: 'Анна Иванова',
};
const capture = vi.hoisted(() => ({ programs: vi.fn() }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {}, actorUserId: 'tg:101', clients: [client], status: 'ready',
    error: '', syncStatus: 'synced', syncError: '',
    refresh: vi.fn(async () => {}), retrySync: vi.fn(async () => {}),
  }),
}));
vi.mock('../data/cloud/program-management-activation', () => ({
  CLOUD_PROGRAM_MANAGEMENT_ENABLED: true,
}));
vi.mock('../program/CloudProgramsPage', () => ({
  CloudProgramsPage: (props: {
    clientScope?: { userId: string; relationshipId: string };
    controls?: { filter: string };
    hideToolbar?: boolean;
  }) => {
    capture.programs(props);
    return <section aria-label="Программы выбранного клиента">Все статусы и фильтры</section>;
  },
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: readonly { value: string; label: string }[];
    value: string; onValueChange: (value: string) => void;
  }) => <div role="tablist">{tabs.map(item => <button type="button" role="tab"
    aria-selected={value === item.value} key={item.value} onClick={() => onValueChange(item.value)}>
    {item.label}
  </button>)}</div>,
}));

beforeEach(() => {
  capture.programs.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('uses the full Programs page with all statuses but scopes it to exactly the selected client', async () => {
  render(<CoachShell initData="verified" destination="clients" onNavigationContextChange={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Открыть клиента Анна Иванова' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Программа' }));
  expect(screen.getByRole('region', { name: 'Программы выбранного клиента' })).toBeTruthy();
  const props = capture.programs.mock.lastCall?.[0];
  expect(props.clientScope).toEqual(client);
  expect(props.hideToolbar).toBeUndefined();
  expect(props.controls).toBeUndefined();
  expect(screen.queryByText('Активные программы клиента')).toBeNull();
});
