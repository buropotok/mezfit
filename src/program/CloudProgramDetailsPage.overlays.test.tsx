// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import { NavigationShell } from '../NavigationShell';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

// Keep the production Shell, FAB registration, popover, summary, sync dialog and hint.
// Only unrelated navigation graphics and drag sensors are replaced.
vi.mock('../ui', async original => {
  const actual = await original<typeof import('../ui')>();
  return { ...actual,
    DatePicker: () => null,
    MezfitNavbar: () => null,
    LiquidGlassIconOnly: ({ fab }: { fab?: ReactNode }) => <div>{fab}</div>,
    LiquidGlassFloatingActionSlot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SortableList: ({ header, footer, items }: React.ComponentProps<typeof actual.SortableList>) =>
      <div>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
  };
});
vi.mock('../client/ClientCoachSelectorModal', () => ({ ClientCoachSelectorModal: () => null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: {}, clients: [], coaches: [] }),
}));
vi.mock('../schedule/SchedulePlanningContext', () => ({
  useSchedulePlanning: () => ({ openDraft: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '');
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return DOMRect.fromRect(this.classList.contains('ui-spotlight-hint__target')
      ? { x: 20, y: 300, width: 140, height: 44 }
      : { x: 0, y: 0, width: 390, height: 600 });
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  localStorage.clear(); window.history.replaceState({}, '');
});

function setup(onSync = vi.fn(async () => {})) {
  const details: ProgramDetails = {
    program: { id: 'plan', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
      coachUserId: null, clientUserId: null, name: 'Программа', position: 0, status: 'active',
      startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' },
    phases: [{ id: 'phase', realmId: 'tg:101', owner: 'tg:101', trainingPlanId: 'plan',
      name: 'Фаза 1', position: 0, status: 'active', plannedStartDate: null, plannedEndDate: null }],
    days: [{ day: { id: 'day', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase',
      name: 'День А', position: 0, status: 'active' }, exercises: [] }],
  };
  const repository = {
    actorUserId: 'tg:101',
    observeDetails: (_id: string, next: (data: ProgramDetails) => void) => {
      next(details); return { unsubscribe: vi.fn() };
    },
    observeSync: (_id: string, next: (row: undefined) => void) => {
      next(undefined); return { unsubscribe: vi.fn() };
    },
    createPhase: vi.fn(), createDay: vi.fn(),
  };
  const me = {
    user: { id: 101, telegramUserId: '101', username: null, firstName: 'Тренер', lastName: null,
      languageCode: 'ru', photoUrl: null, isPremium: false },
    roles: ['coach' as const],
  };
  const blockedEdit = vi.fn();
  const navigationContext = { level: 2 as const, title: 'Программа тренировок' };
  const onDestinationChange = vi.fn();
  const onRoleSwitch = vi.fn();
  const page = (selectionFeedbackVisible: boolean) => (
    <NavigationShell me={me} activeRole="coach" destination="today"
      context={navigationContext} onDestinationChange={onDestinationChange} onRoleSwitch={onRoleSwitch}>
      <CloudProgramDetailsPage repository={repository as unknown as ProgramManagementRepository}
        planId="plan" selectionMode onSelectionMutationAttempt={blockedEdit}
        selectionFeedbackVisible={selectionFeedbackVisible}
        cloudStatus="ready" cloudError="" syncStatus="offline" syncError=""
        onRetryCloud={async () => {}} onRetrySync={onSync} />
    </NavigationShell>
  );
  const view = render(page(false));
  return { ...repository, blockedEdit, setFeedbackVisible: (visible: boolean) => view.rerender(page(visible)) };
}

describe('planning guidance with production overlay owners', () => {
  it('pauses for the sibling navigation FAB and blocked-edit feedback, then resumes', async () => {
    const repository = setup();
    expect(await screen.findByLabelText('Подсказка')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(screen.queryByLabelText('Подсказка')).toBeNull());
    const menu = await screen.findByRole('menu', { name: 'Добавить' });
    const addPhase = within(menu).getByRole('menuitem', { name: 'Фаза' });
    await waitFor(() => expect(addPhase.closest('[inert]')).toBeNull());
    fireEvent.click(addPhase);
    expect(repository.blockedEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Планирование тренировки' })).toBeNull();
    expect(repository.createPhase).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Подсказка')).toBeTruthy());

    // The scheduling owner shows a toast and passes its visibility to the
    // program details page. Preserve this real FAB/Spotlight integration.
    repository.setFeedbackVisible(true);
    await waitFor(() => expect(screen.queryByLabelText('Подсказка')).toBeNull());
    repository.setFeedbackVisible(false);
    await waitFor(() => expect(screen.getByLabelText('Подсказка')).toBeTruthy());
    expect(localStorage.length).toBe(0);
  });

  it('pauses while the real synchronization dialog is open and resumes after cancel', async () => {
    setup();
    expect(await screen.findByLabelText('Подсказка')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизировать' }));
    const dialog = screen.getByLabelText('Синхронизация с облаком');
    await waitFor(() => expect(screen.queryByLabelText('Подсказка')).toBeNull());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.getByLabelText('Подсказка')).toBeTruthy());
  });

  it('keeps guidance paused on synchronization failure until the dialog closes', async () => {
    const sync = vi.fn(async () => { throw new Error('offline'); });
    setup(sync);
    expect(await screen.findByLabelText('Подсказка')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизировать' }));
    const dialog = screen.getByLabelText('Синхронизация с облаком');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Да' }));
    await within(dialog).findByRole('alert');
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.getByLabelText('Подсказка')).toBeTruthy());
  });
});
