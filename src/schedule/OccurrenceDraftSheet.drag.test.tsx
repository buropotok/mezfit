// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutPlanCardProps } from '../workout/WorkoutPlanCard';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => null }));
vi.mock('../workout/WorkoutPlanCard', () => ({
  WorkoutPlanCard: ({ day, onReorderExercises, portalDragOverlay, preserveDragHeight }: WorkoutPlanCardProps) =>
    <div data-testid="scheduled-plan" data-portal={String(portalDragOverlay)}
      data-stable-height={String(preserveDragHeight)}>
      <span data-testid="exercise-order">{day.exercises.map(ex => ex.exercise.id).join(',')}</span>
      <button onClick={() => onReorderExercises?.([...day.exercises].reverse().map(ex => ex.exercise.id))}>
        Переставить упражнения
      </button>
    </div>,
}));
vi.mock('../ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Avatar: () => null,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  Text: ({ children, role }: { children: ReactNode; role?: string }) => <span role={role}>{children}</span>,
  Icon: () => null,
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
  IconButton: ({ label, onClick }: { label: string; onClick?: () => void }) =>
    <button aria-label={label} onClick={onClick} />,
  MezfitBottomSheet: ({ children }: { children: ReactNode }) =>
    <div data-testid="sheet-shell">{children}</div>,
  DatePicker: () => null,
  TimePicker: () => null,
  MezfitDialog: () => null,
  MezfitDialogButton: () => null,
}));

afterEach(cleanup);

const exercise = (id: string, position: number) => ({
  id, sourceProgramExerciseId: null, position, notes: null, sets: [],
  exercise: { exerciseDefinitionId: id, scope: 'public' as const,
    name: id, nameEn: null, mediaUrl: null },
});
const plan = {
  name: 'День', comment: null,
  exercises: [exercise('first', 0), exercise('second', 1)],
};
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:one', actorUserId: 'tg:101', realmId: 'tg:101',
  trainingPlanId: 'program', programDayId: 'day',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
  plan, originalPlan: plan, createdAt: '', updatedAt: '',
};

function fixture() {
  const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
  vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
  vi.spyOn(drafts, 'get').mockResolvedValue(draft);
  const props = { drafts, onClose: vi.fn(), onSave: vi.fn(async () => {}) };
  return { drafts, props };
}

describe('scheduled workout reorder inside a scrollable bottom sheet', () => {
  it('opts into viewport overlay and height stabilization without altering program UIkit defaults', () => {
    const { props } = fixture();
    render(<OccurrenceDraftSheet {...props} draft={draft} />);
    expect(screen.getByTestId('scheduled-plan').getAttribute('data-portal')).toBe('true');
    expect(screen.getByTestId('scheduled-plan').getAttribute('data-stable-height')).toBe('true');
  });

  it('displays the new order immediately and reconciles when authoritative local data arrives', async () => {
    const { drafts, props } = fixture();
    const pending = new Promise<void>(() => {});
    const enqueue = vi.spyOn(drafts, 'enqueueEdit').mockImplementation(() => pending);
    const view = render(<OccurrenceDraftSheet {...props} draft={draft} />);

    fireEvent.click(screen.getByRole('button', { name: 'Переставить упражнения' }));
    expect(screen.getByTestId('exercise-order').textContent).toBe('second,first');
    await waitFor(() => expect(enqueue).toHaveBeenCalledOnce());

    view.rerender(<OccurrenceDraftSheet {...props} draft={{ ...draft, saved: true }} />);
    expect(screen.getByTestId('exercise-order').textContent).toBe('second,first');

    const canonical = { ...draft, plan: {
      ...draft.plan,
      exercises: [...draft.plan.exercises].reverse().map((item, position) => ({ ...item, position })),
    } };
    view.rerender(<OccurrenceDraftSheet {...props} draft={canonical} />);
    await waitFor(() => expect(screen.getByTestId('exercise-order').textContent).toBe('second,first'));

    // A later authoritative content change wins over a stale local preview.
    view.rerender(<OccurrenceDraftSheet {...props} draft={{ ...canonical, plan: {
      ...canonical.plan, exercises: [canonical.plan.exercises[0]],
    } }} />);
    await waitFor(() => expect(screen.getByTestId('exercise-order').textContent).toBe('second'));
  });

  it('rolls the immediate order back when the draft repository rejects the reorder', async () => {
    const { drafts, props } = fixture();
    let rejectWrite: (reason: Error) => void = () => {};
    const enqueue = vi.spyOn(drafts, 'enqueueEdit').mockImplementation(() => new Promise<void>((_, reject) => {
      rejectWrite = reject;
    }));
    render(<OccurrenceDraftSheet {...props} draft={draft} />);

    fireEvent.click(screen.getByRole('button', { name: 'Переставить упражнения' }));
    expect(screen.getByTestId('exercise-order').textContent).toBe('second,first');
    await waitFor(() => expect(enqueue).toHaveBeenCalledOnce());

    await act(async () => rejectWrite(new Error('Ошибка сохранения')));
    await waitFor(() => expect(screen.getByTestId('exercise-order').textContent).toBe('first,second'));
    expect(screen.getByRole('alert').textContent).toContain('Ошибка сохранения');
  });
});
