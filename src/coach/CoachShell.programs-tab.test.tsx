// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { NavigationContext } from '../NavigationShell';
import { CoachShell } from './CoachShell';

const client = { relationshipId: 'realm-202', userId: 'tg:202', telegramUserId: '202', displayName: 'Анна Иванова' };
const plan: CloudTrainingPlanRow = {
  id: 'plan-202', realmId: client.relationshipId, owner: null,
  coachUserId: 'tg:101', clientUserId: client.userId, athleteUserId: client.userId,
  name: 'Программа Анны', status: 'active', position: 0,
  createdAt: '', updatedAt: '', startedAt: null, finishedAt: null,
};

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({
    db: {}, actorUserId: 'tg:101', clients: [client], coaches: [],
    status: 'ready', error: '', syncStatus: 'synced', syncError: '',
    refresh: vi.fn(async () => {}), retrySync: vi.fn(async () => {}),
  }),
}));
vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: {
    tabs: ReadonlyArray<{ value: string; label: string }>;
    value: string;
    onValueChange: (value: string) => void;
  }) => <div role="tablist">{tabs.map((tab) =>
    <button key={tab.value} type="button" role="tab" aria-selected={tab.value === value}
      onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}</div>,
}));
vi.mock('../program/CloudProgramsPage', () => ({
  CloudProgramsPage: ({ clientScope, hideToolbar, onOpen }: {
    clientScope?: typeof client;
    hideToolbar?: boolean;
    onOpen: (plan: CloudTrainingPlanRow) => void;
  }) => <section aria-label="Список программ клиента">
    <span>{clientScope?.relationshipId}</span>
    <span>{hideToolbar ? 'Без общего фильтра' : 'С фильтром'}</span>
    <button type="button" onClick={() => onOpen(plan)}>{plan.name}</button>
  </section>,
}));
vi.mock('../program/CloudProgramDetailsPage', () => ({
  CloudProgramDetailsPage: ({ planId, viewerRole }: { planId: string; viewerRole: string }) =>
    <section aria-label="Детали программы" data-plan-id={planId} data-viewer-role={viewerRole}>Детали {planId}</section>,
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CoachShell selected client program navigation', () => {
  it('opens the exact shared coach detail view and returns to the same client program tab', async () => {
    const onNavigationContextChange = vi.fn();
    render(<CoachShell destination="clients" initData="verified"
      onNavigationContextChange={onNavigationContextChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть клиента Анна Иванова' }));
    expect(screen.queryByRole('region', { name: 'Список программ клиента' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Программа' }));
    expect(screen.getByText(client.relationshipId)).toBeTruthy();
    expect(screen.getByText('Без общего фильтра')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: plan.name }));

    const details = screen.getByRole('region', { name: 'Детали программы' });
    expect(details.getAttribute('data-plan-id')).toBe(plan.id);
    expect(details.getAttribute('data-viewer-role')).toBe('coach');
    await waitFor(() => expect(onNavigationContextChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Детали программы', scrollKey: `cloud-plan:${plan.id}` }),
    ));
    const context = onNavigationContextChange.mock.calls.map(([value]: [NavigationContext | null]) => value)
      .reverse().find((value) => value?.title === 'Детали программы');
    expect(context?.onBack).toBeTypeOf('function');
    act(() => context?.onBack?.());

    expect(screen.queryByRole('region', { name: 'Детали программы' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Программа' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: plan.name })).toBeTruthy();
  });
});
