// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { nextAvailableSlot } from '../schedule/available-slot';
import { ProgramPhaseDays } from './ProgramPhaseDays';

const state = vi.hoisted(() => ({
  calendar: vi.fn(), listDrafts: vi.fn(), create: vi.fn(), openDraft: vi.fn(),
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: {}, clients: [], coaches: [] }) }));
vi.mock('../data/cloud/workout-scheduling', () => ({ WorkoutSchedulingRepository: class { listCalendar = state.calendar; } }));
vi.mock('../data/cloud/workout-occurrence-drafts', () => ({ WorkoutOccurrenceDraftRepository: class { list = state.listDrafts; create = state.create; } }));
vi.mock('../schedule/SchedulePlanningContext', () => ({ useSchedulePlanning: () => ({ openDraft: state.openDraft }) }));
vi.mock('../schedule/available-slot', () => ({ nextAvailableSlot: vi.fn(() => new Date('2026-10-19T08:00:00.000Z')) }));
vi.mock('../workout/WorkoutSessionCard', () => ({ WorkoutSessionCard: ({ onSchedule }: { onSchedule?: (format: 'independent') => void }) => <button onClick={() => onSchedule?.('independent')}>Запланировать</button> }));
vi.mock('../ui', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>, Avatar: () => null }));
vi.mock('./usePhaseDayMotion', () => ({ usePhaseDayMotion: () => {} }));
vi.mock('./ProgramDayExercisePicker', () => ({ ProgramDayExercisePicker: () => null }));
vi.mock('./ProgramDayDialog', () => ({ ProgramDayDialog: () => null }));
vi.mock('./PlanActionDialog', () => ({ PlanActionDialog: () => null }));

const program: CloudTrainingPlanRow = {
  id: 'program', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
  coachUserId: null, clientUserId: null, name: 'Программа', position: 0, status: 'active',
  startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
};
const day = { day: { id: 'day', realmId: 'tg:101', owner: null, programPhaseId: 'phase',
  status: 'active' as const, position: 0, name: 'День', comment: null }, exercises: [] };
const open = () => render(<ProgramPhaseDays repository={{ actorUserId: 'tg:101' } as ProgramManagementRepository}
  program={program} phaseStatus="active" days={[day]} readOnly />);
beforeEach(() => {
  vi.clearAllMocks(); state.calendar.mockResolvedValue([]); state.listDrafts.mockResolvedValue([]);
  state.create.mockResolvedValue('draft');
});
afterEach(cleanup);

describe('program scheduling lifecycle', () => {
  it('waits for activation and reads the freshly activated program before creating the draft', async () => {
    let onActivated: (() => Promise<void>) | undefined;
    const activate = vi.fn((_phase: string, next: () => Promise<void>) => { onActivated = next; });
    const details = vi.fn().mockResolvedValue({ program, days: [day], phases: [{ id: 'phase', status: 'active' }] });
    render(<ProgramPhaseDays repository={{ actorUserId: 'tg:101', details } as unknown as ProgramManagementRepository}
      program={{ ...program, status: 'draft' }} phaseStatus="pending" days={[day]} readOnly={false}
      onActivateForScheduling={activate} />);
    fireEvent.click(screen.getByText('Запланировать'));
    expect(activate).toHaveBeenCalledWith('phase', expect.any(Function));
    expect(state.create).not.toHaveBeenCalled();
    await act(async () => { await onActivated?.(); });
    expect(details).toHaveBeenCalledWith('program');
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.openDraft).toHaveBeenCalled();
  });

  it('includes private local drafts when suggesting the next slot', async () => {
    const draft = { startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60, athleteUserId: 'tg:101', coachUserId: null };
    state.listDrafts.mockResolvedValue([draft]);
    open(); fireEvent.click(screen.getByText('Запланировать'));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(nextAvailableSlot).mock.calls[0][0]).toContainEqual(draft);
  });

  it('also reserves coached client drafts when planning the coach own independent workout', async () => {
    const coached = { startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
      athleteUserId: 'tg:202', coachUserId: 'tg:101', format: 'coached' };
    state.listDrafts.mockResolvedValue([coached, { ...coached, format: 'independent' }]);
    open(); fireEvent.click(screen.getByText('Запланировать'));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(nextAvailableSlot).mock.calls[0][0]).toEqual([coached]);
  });

  it('keeps the created draft but never navigates after leaving during creation', async () => {
    let finish: () => void = () => {};
    state.create.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = open(); fireEvent.click(screen.getByText('Запланировать'));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { finish(); });
    expect(state.openDraft).not.toHaveBeenCalled();
    expect((state.create.mock.calls[0][0] as LocalWorkoutOccurrenceDraft).plan.name).toBe('День');
  });

  it('never navigates after leaving during the calendar read', async () => {
    let finish: (rows: []) => void = () => {};
    state.calendar.mockImplementation(() => new Promise<[]>(resolve => { finish = resolve; }));
    const view = open(); fireEvent.click(screen.getByText('Запланировать'));
    await waitFor(() => expect(state.calendar).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { finish([]); });
    expect(state.openDraft).not.toHaveBeenCalled();
  });
});
