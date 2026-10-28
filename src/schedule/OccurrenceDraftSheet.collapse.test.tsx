// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SortableListProps } from '../ui/SortableList';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';

vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => null }));
vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => null }));
vi.mock('../workout/SessionExercise', () => ({ SessionExercise: () => <div>Упражнение плана</div> }));
vi.mock('../ui', async original => ({
  ...await original<typeof import('../ui')>(),
  SortableList: ({ header, items, footer, surface }: SortableListProps) => <div data-testid="plan-list" data-surface={surface}>{header}
    {items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
  MezfitBottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  DatePicker: () => null, TimePicker: () => null, MezfitDialog: () => null,
}));
afterEach(cleanup);

it('collapses only the plan, shows its compact timing and keeps the planning sheet open', () => {
  const plan = { name: 'День А', comment: 'Комментарий дня', exercises: [{
    id: 'exercise', sourceProgramExerciseId: null, position: 0, notes: null, sets: [],
    exercise: { exerciseDefinitionId: '0001', scope: 'public' as const, name: 'Жим', nameEn: null, mediaUrl: null },
  }] };
  const draft: LocalWorkoutOccurrenceDraft = {
    id: 'draft:one', actorUserId: 'tg:101', realmId: 'tg:101', athleteUserId: 'tg:101',
    coachUserId: null, clientUserId: null, format: 'independent', saved: true,
    startsAtUtc: '2026-10-28T08:00:00.000Z', durationMinutes: 60, plan, originalPlan: plan,
    createdAt: '', updatedAt: '',
  };
  const repository = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
  vi.spyOn(repository, 'flushEdits').mockResolvedValue(undefined);
  vi.spyOn(repository, 'pendingEditError').mockReturnValue('');
  const close = vi.fn();
  const view = render(<OccurrenceDraftSheet draft={draft} drafts={repository} onClose={close} onSave={vi.fn()} />);
  expect(screen.getByText('Упражнение плана')).toBeTruthy();
  expect(screen.queryByText('28.10.2026')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Свернуть тренировку' }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText('Запланированная тренировка')).toBeTruthy();
  expect(screen.getByText('28.10.2026')).toBeTruthy();
  expect(screen.queryByText('Упражнение плана')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Развернуть тренировку' }));
  expect(screen.getByText('Упражнение плана')).toBeTruthy();
  expect(screen.queryByText('28.10.2026')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  view.rerender(<OccurrenceDraftSheet inlineCard draft={draft} drafts={repository} onClose={close} onSave={vi.fn()} />);
  expect(screen.getByTestId('plan-list').getAttribute('data-surface')).toBe('transparent');
});
