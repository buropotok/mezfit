// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutPlanningRepository } from '../data/cloud/workout-planning';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { WorkoutProgramSheet } from './WorkoutProgramSheet';

vi.mock('../ui/LiquidGlassTextOnly', () => ({ LiquidGlassTextOnly: ({ tabs, onValueChange }: {
  tabs: Array<{ value: string; label: string }>; onValueChange: (value: string) => void;
}) => <div>{tabs.map(tab => <button key={tab.value} onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}</div> }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
  MezfitDialog: ({ opened, children, buttons }: { opened: boolean; children: ReactNode; buttons: ReactNode }) => opened ? <div role="dialog">{children}{buttons}</div> : null,
}));
afterEach(cleanup);
const prescription = { name: 'Тренировка', comment: null, exercises: [] };
const draft: LocalWorkoutOccurrenceDraft = { id: 'draft:one', actorUserId: 'tg:101', realmId: 'tg:101',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null, format: 'independent',
  startsAtUtc: '2026-10-20T08:00:00.000Z', durationMinutes: 60,
  plan: prescription, originalPlan: prescription, createdAt: '', updatedAt: '' };
function setup() {
  const addToProgram = vi.fn().mockResolvedValue('new-day');
  const unsubscribe = vi.fn();
  const planner = { addToProgram, programs: { observeWorkoutTargets: vi.fn((_athlete: string, next: (rows: unknown[]) => void) => {
    next([{ program: { id: 'p', name: 'Моя программа' }, phases: [{ id: 'f', name: 'Фаза 1' }],
      days: [{ day: { id: 'd', programPhaseId: 'f', name: 'День А' }, exercises: [] }] }]);
    return { unsubscribe };
  }) } } as unknown as WorkoutPlanningRepository;
  const close = vi.fn();
  const view = render(<WorkoutProgramSheet opened planner={planner} draft={draft} onClose={close} />);
  return { ...view, addToProgram, close, unsubscribe };
}
describe('workout program target selection', () => {
  it('hides the day level for a new day and retains the selected phase across mode changes', async () => {
    const { addToProgram, close } = setup();
    expect(screen.queryByText('День А')).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фазу' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить день' }));
    expect(screen.getByText('День А')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Создать новый день' }));
    expect(screen.queryByText('День А')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(addToProgram).toHaveBeenCalledWith('draft:one', expect.objectContaining({ programId: 'p', phaseId: 'f', dayId: undefined, name: 'Тренировка' }));
  });
  it('requires confirmation before replacing a selected day', async () => {
    const { addToProgram } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(addToProgram).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(addToProgram).toHaveBeenCalledOnce());
    expect(addToProgram).toHaveBeenCalledWith('draft:one', expect.objectContaining({ dayId: 'd', expected: expect.objectContaining({ name: 'День А' }) }));
  });
});
