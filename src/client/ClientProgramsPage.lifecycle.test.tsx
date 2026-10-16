// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext } from '../NavigationShell';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { ProgramManagementRepository, type ProgramDetails } from '../data/cloud/program-management';
import type { LiquidGlassTextOnlyProps } from '../ui/LiquidGlassTextOnly';
import { ClientProgramsPage } from './ClientProgramsPage';

vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: LiquidGlassTextOnlyProps) => (
    <div role="tablist">{tabs.map((tab) => <button key={tab.value} role="tab"
      aria-selected={tab.value === value} onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}</div>
  ),
}));
vi.mock('../data/cloud/program-management-activation', () => ({ CLOUD_PROGRAM_MANAGEMENT_ENABLED: true }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: vi.fn() }));
const coach = (id: string): CloudContact => ({
  userId: `tg:${id}`, telegramUserId: id, relationshipId: `rlm-${id}`, displayName: `Тренер ${id}`,
});
function plan(id: string): CloudTrainingPlanRow {
  return {
    id: `plan-${id}`, realmId: `rlm-${id}`, owner: `tg:${id}`,
    coachUserId: `tg:${id}`, clientUserId: 'tg:101', name: `Программа ${id}`,
    position: 0, status: 'active', startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
  };
}
const refresh = vi.fn(async () => undefined);
const retrySync = vi.fn(async () => undefined);
const unsubscribe = vi.fn();
let emit: (rows: CloudTrainingPlanRow[]) => void;
let fail: (error: unknown) => void;
const assigned: ProgramDetails = { program: plan('202'), phases: [{
  id: 'phase', realmId: 'rlm-202', owner: 'tg:202', trainingPlanId: 'plan-202',
  name: 'Опубликованная фаза', status: 'pending', position: 0,
  plannedStartDate: null, plannedEndDate: null,
}] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(useCloudConnections).mockReturnValue({
    db: {} as NonNullable<ReturnType<typeof useCloudConnections>>['db'],
    actorUserId: 'tg:101', clients: [], coaches: [coach('202'), coach('303')],
    status: 'ready', error: '', syncStatus: 'offline', syncError: 'Нет сети',
    refresh, retrySync, loadAvatar: async () => null,
  });
  vi.spyOn(ProgramManagementRepository.prototype, 'observeForAthlete')
    .mockImplementation((next, error) => {
      emit = next; fail = error; next([plan('202'), plan('303')]);
      return { unsubscribe, closed: false };
    });
  vi.spyOn(ProgramManagementRepository.prototype, 'observeAthleteDetails')
    .mockImplementation((_id, next) => {
      next(assigned); return { unsubscribe: vi.fn(), closed: false };
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('client program directory', () => {
  it('shows both sections and every coach as lists, with sync retry and status filters', async () => {
    render(<ClientProgramsPage />);
    expect(await screen.findByText('Программа 202')).toBeTruthy();
    expect(screen.getByText('Программа 303')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Мои программы' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Тренерские программы' })).toBeTruthy();
    const empty = screen.getByText('Мы не создали ни одной личной программы');
    expect(empty.closest('.ui-glass-surface')).toBeNull();
    expect(screen.queryByText('Опубликованная фаза')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Мои программы' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'От тренера' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поиск программ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить синхронизацию' }));
    await waitFor(() => expect(retrySync).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Черновики' }));
    expect(screen.queryByText('Программа 202')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Все' }));
    expect(screen.getByText('Программа 202')).toBeTruthy();
  });

  it('opens assigned details read-only and returns to the directory through navigation', async () => {
    const navigation = vi.fn<(context: NavigationContext | null) => void>();
    render(<ClientProgramsPage onNavigationContextChange={navigation} />);
    fireEvent.click(await screen.findByText('Программа 202'));
    expect(await screen.findByText('Опубликованная фаза')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Действия с фазой/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Тренерские программы' })).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
    act(() => navigation.mock.lastCall?.[0]?.onBack?.());
    expect(await screen.findByText('Программа 303')).toBeTruthy();
    expect(screen.queryByText('Опубликованная фаза')).toBeNull();
  });

  it('unsubscribes old observers on account changes and exposes subscription errors', async () => {
    const view = render(<ClientProgramsPage />);
    await screen.findByText('Программа 202');
    const previousEmit = emit;
    const current = vi.mocked(useCloudConnections)()!;
    vi.mocked(useCloudConnections).mockReturnValue({ ...current, actorUserId: 'tg:404', coaches: [] });
    vi.mocked(ProgramManagementRepository.prototype.observeForAthlete).mockImplementation((_next, error) => {
      fail = error; return { unsubscribe: vi.fn(), closed: false };
    });
    view.rerender(<ClientProgramsPage />);
    act(() => { previousEmit([plan('202')]); fail(new Error('Не удалось загрузить программы')); });
    expect(screen.queryByText('Программа 202')).toBeNull();
    expect(screen.getAllByText('Не удалось загрузить программы')
      .some((node) => !node.closest('[role="dialog"]'))).toBe(true);
    expect(unsubscribe).toHaveBeenCalled();
  });
});
