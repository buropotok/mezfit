// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import { ProgramPhaseDays } from './ProgramPhaseDays';

const state = vi.hoisted(() => ({
  createDraft: vi.fn(), openDraft: vi.fn(),
  startFromProgram: vi.fn(), showSession: vi.fn(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: {}, actorUserId: 'tg:101', clients: [], coaches: [], selfAvatars: [] }),
}));
vi.mock('../workout/PlannedWorkoutStartContext', () => ({
  usePlannedWorkoutStart: () => ({ startFromProgram: state.startFromProgram, showSession: state.showSession }),
}));
vi.mock('../data/cloud/workout-planning', () => ({
  WorkoutPlanningRepository: class { createFromProgramDay = state.createDraft; },
}));
vi.mock('../schedule/SchedulePlanningContext', () => ({
  useSchedulePlanning: () => ({ openDraft: state.openDraft }),
}));
vi.mock('../schedule/WorkoutPerson', () => ({
  useWorkoutPerson: () => ({ name: 'Атлет', avatar: null }),
}));
vi.mock('../ui', () => ({
  Avatar: () => null,
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  MezfitDialog: ({ opened, title, buttons }: { opened?: boolean; title?: string; buttons?: ReactNode }) =>
    opened ? <div role="dialog" aria-label={title}>{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: {
    children: ReactNode; onClick: () => void; disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));
vi.mock('../workout/WorkoutSessionCard', () => ({
  WorkoutSessionCard: ({ onStart, onOpenSet }: {
    onStart?: () => void; onOpenSet?: (exerciseId: string, setId: string) => void;
  }) => <div>
    <button disabled={!onStart} onClick={onStart}>Начать тренировку</button>
    <button onClick={() => onOpenSet?.('ex', 'set')}>Подход 1</button>
  </div>,
}));
vi.mock('./usePhaseDayMotion', () => ({ usePhaseDayMotion: () => {} }));
vi.mock('./ProgramDayExercisePicker', () => ({ ProgramDayExercisePicker: () => null }));
vi.mock('./ProgramDayDialog', () => ({ ProgramDayDialog: () => null }));
vi.mock('./PlanActionDialog', () => ({ PlanActionDialog: () => null }));

const program: CloudTrainingPlanRow = {
  id: 'program', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
  coachUserId: null, clientUserId: null, name: 'Программа', status: 'active', position: 0,
  startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
};
const day = { day: { id: 'day', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase',
  status: 'active' as const, position: 0, name: 'День', comment: null }, exercises: [] };
beforeEach(() => {
  vi.clearAllMocks();
  state.createDraft.mockResolvedValue('scheduled-draft');
  state.startFromProgram.mockResolvedValue({ id: 'active-session', createdProgram: false });
});
afterEach(cleanup);
const page = (options: { readOnly?: boolean; onStartDay?: (id: string) => Promise<void>;
  allowDirectStart?: boolean } = {}) =>
  <ProgramPhaseDays repository={{ actorUserId: 'tg:101' } as ProgramManagementRepository}
    program={program} phaseStatus="active" days={[day]} readOnly={options.readOnly ?? false}
    onStartDay={options.onStartDay} allowDirectStart={options.allowDirectStart} />;

describe('program-day plan prompt and independent execution', () => {
  it('explains why a program set cannot be filled, and creates an independent calendar draft on confirmation', async () => {
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Подход 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Для ввода значений запланируйте тренировку.' });
    const scheduleButton = within(dialog).getByRole('button', { name: 'Запланировать' });
    expect(scheduleButton.querySelector('[data-icon="calendar-plus"]')).not.toBeNull();
    expect(state.createDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(state.createDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Подход 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Запланировать' }));
    await waitFor(() => expect(state.createDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.openDraft).toHaveBeenCalledWith('scheduled-draft', null));
  });

  it('starts an independent workout directly, preserving program selection and navigating to FACT', async () => {
    render(page({ readOnly: true }));
    const button = screen.getByRole('button', { name: 'Начать тренировку' });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(state.startFromProgram).toHaveBeenCalledWith({
      athleteUserId: 'tg:101', programId: 'program', dayId: 'day', independent: true,
    }, expect.any(Function)));
    await waitFor(() => expect(state.showSession).toHaveBeenCalledWith('active-session'));
  });

  it('keeps source-picker start callback independent of the new direct-start action', async () => {
    const onStartDay = vi.fn(async () => {});
    render(page({ onStartDay, allowDirectStart: false }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' })));
    expect(onStartDay).toHaveBeenCalledWith('day');
    expect(state.startFromProgram).not.toHaveBeenCalled();
  });
});
