// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

const continuation = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../NavigationShell', () => ({ useNavigationSurfaceFloatingAction: () => {} }));
vi.mock('./ProgramSummary', () => ({ ProgramSummary: () => null }));
vi.mock('./PlanSyncNotice', () => ({ PlanSyncNotice: () => null }));
vi.mock('./ProgramPhaseDays', () => ({ ProgramPhaseDays: ({ onActivateForScheduling }: {
  onActivateForScheduling: (phase: string, next: () => Promise<void>) => void;
}) => <button onClick={() => onActivateForScheduling('phase', continuation)}>Запланировать</button> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(fail = false) {
  const program = { id: 'plan', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
    coachUserId: null, clientUserId: null, name: 'Новая программа', position: 0, status: 'draft' as const,
    startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' };
  const details: ProgramDetails = { program, phases: [{ id: 'phase', realmId: 'tg:101', owner: 'tg:101',
    trainingPlanId: 'plan', name: 'Фаза', position: 0, status: 'pending', plannedStartDate: null, plannedEndDate: null }] };
  const activate = vi.fn(async () => { if (fail) throw new Error('Не удалось активировать'); });
  const repository = { actorUserId: 'tg:101', activate,
    listReadable: async () => [program, { ...program, id: 'other', status: 'active' }],
    observeDetails: (_id: string, next: (details: ProgramDetails) => void) => {
      next(details); return { unsubscribe: () => {} };
    },
  } as unknown as ProgramManagementRepository;
  render(<CloudProgramDetailsPage repository={repository} planId="plan" cloudStatus="ready" cloudError=""
    syncStatus="offline" syncError="" onRetryCloud={async () => {}} onRetrySync={async () => {}} />);
  return activate;
}

describe('activation before scheduling', () => {
  it('warns, uses the standard previous-program status dialog, then continues', async () => {
    const activate = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Запланировать' }));
    expect(screen.getByRole('dialog', { name: 'Программа будет активирована.' })).toBeTruthy();
    expect(activate).not.toHaveBeenCalled(); expect(continuation).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Программа будет активирована.' })).getByRole('button', { name: 'Подтвердить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Выберите статус для текущей активной программы' });
    expect(continuation).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Подтвердить' });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(continuation).toHaveBeenCalledTimes(1));
    expect(activate).toHaveBeenCalledWith('plan', 'phase', {
      previousPhaseStatus: undefined, previousProgramStatus: 'finished',
    });
  });

  it('does not activate or create on cancellation', async () => {
    const activate = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Запланировать' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Программа будет активирована.' })).getByRole('button', { name: 'Отмена' }));
    expect(activate).not.toHaveBeenCalled(); expect(continuation).not.toHaveBeenCalled();
  });

  it('does not continue when local activation fails', async () => {
    setup(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Запланировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Выберите статус для текущей активной программы' });
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Подтвердить' });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(continuation).not.toHaveBeenCalled();
  });
});
