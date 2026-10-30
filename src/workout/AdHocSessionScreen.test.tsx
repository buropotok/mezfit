// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import type { AdHocSessionRow } from '../data/cloud/adhoc-workout-types';
import { AdHocSessionScreen, type AdHocSessionRepository } from './AdHocSessionScreen';
import type { WorkoutFactCardProps } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

const overlays = vi.hoisted(() => ({
  finish: null as (() => void) | null,
  review: vi.fn(),
  select: null as ((ids: string[]) => void) | null,
}));

vi.mock('./WorkoutCompletionContext', () => ({ useWorkoutCompletionReview: () => ({ active: false, reviewCompleted: overlays.review }) }));
vi.mock('../schedule/WorkoutPerson', () => ({ useWorkoutPerson: () => ({ name: 'Атлет', avatar: <span>Фото атлета</span>, compactAvatar: null }) }));
vi.mock('konsta/react', () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('../ui', () => ({
  Text: ({ children, role }: HTMLAttributes<HTMLSpanElement>) => <span role={role}>{children}</span>,
  GlassSurface: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick}>{children}</button>,
  MezfitDialog: ({ opened, title, children, buttons }: {
    opened?: boolean; title?: ReactNode; children?: ReactNode; buttons?: ReactNode;
  }) => opened ? <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
    {children}{buttons}
  </div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: {
    children?: ReactNode; onClick?: () => void; disabled?: boolean;
  }) => {
    if (children === 'Завершить') overlays.finish = onClick ?? null;
    return <button onClick={onClick} disabled={disabled}>{children}</button>;
  },
}));
vi.mock('./WorkoutExerciseSelectionSheet', () => ({
  WorkoutExerciseSelectionSheet: ({ opened, saving, onConfirm, onClose }: {
    opened?: boolean; saving: boolean; onConfirm: (ids: string[]) => void; onClose: () => void;
  }) => {
    if (!opened) return null;
    overlays.select = onConfirm;
    return <div role="dialog" aria-label="Выбор упражнений для тренировки">
      <button disabled={saving} onClick={() => onConfirm(['definition-d2'])}>Добавить выбранные упражнения</button>
      <button disabled={saving} onClick={onClose}>Закрыть выбор</button>
    </div>;
  },
}));
vi.mock('./WorkoutSessionCard', () => ({
  WorkoutSessionCard: ({ session, title, onAddSet, onAddExercise, onDeleteExercise }: WorkoutFactCardProps<string>) => (
    <div data-testid="session-card">
      <span>{title ?? 'Без названия'}</span>
      {onDeleteExercise ? <button onClick={() => onDeleteExercise('exercise-x1')}>Удалить упражнение</button> : null}
      <button onClick={onAddExercise}>Добавить упражнение</button>
      {session.exercises.map(exercise => <button key={exercise.sessionExerciseId}
        onClick={() => onAddSet?.(exercise.sessionExerciseId)}>Добавить подход</button>)}
    </div>
  ),
}));

const session: ActiveWorkoutSession<string> = {
  sessionId: 'session-a1', occurrenceId: null, status: 'active', workoutDate: '2026-10-27',
  startedAt: '2026-10-27T10:00:00.000Z', completedAt: null, program: null, phase: null, day: null,
  exercises: [{
    sessionExerciseId: 'exercise-x1', workoutSessionId: 'session-a1', sourceProgramExerciseId: null,
    position: 0, status: 'active', notes: null, sets: [],
    exercise: {
      id: 'definition-d1', name: 'Жим лёжа', scope: 'global', description: null,
      tracking_type: 'weight_reps', category_code: 'chest', equipment_code: 'barbell',
      reference_source: null, reference_key: null, reference_media_url: null,
      is_favourite: false, can_edit: false,
    },
  }],
};
const row: AdHocSessionRow = {
  id: 'session-a1', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
  coachUserId: null, clientUserId: null, creatorUserId: 'tg:101', name: 'Исходная тренировка',
  comment: null, programName: null, autoCreatedProgram: false, status: 'active',
  startedAt: '2026-10-27T10:00:00.000Z', completedAt: null,
  createdAt: '2026-10-27T10:00:00.000Z', updatedAt: '2026-10-27T10:00:00.000Z',
};

type Observation = {
  next: Parameters<AdHocWorkoutRepository['observe']>[1];
  error: Parameters<AdHocWorkoutRepository['observe']>[2];
  unsubscribe: () => void;
};
function fixture() {
  const observations: Observation[] = [];
  const observe = vi.fn<AdHocWorkoutRepository['observe']>((_id, next, error) => {
    const observation = { next, error, unsubscribe: vi.fn<() => void>() };
    observations.push(observation);
    return { unsubscribe: observation.unsubscribe };
  });
  const addSet = vi.fn<AdHocWorkoutRepository['addSet']>().mockResolvedValue(undefined);
  const complete = vi.fn<AdHocWorkoutRepository['complete']>().mockResolvedValue(undefined);
  const addExercises = vi.fn<AdHocWorkoutRepository['addExercises']>().mockResolvedValue(undefined);
  const repository = {
    actorUserId: 'tg:101', observe, addSet, complete, addExercises,
    reorder: vi.fn<AdHocWorkoutRepository['reorder']>().mockResolvedValue(undefined),
    saveSet: vi.fn<AdHocWorkoutRepository['saveSet']>().mockResolvedValue(undefined),
    deleteSet: vi.fn<AdHocWorkoutRepository['deleteSet']>().mockResolvedValue(undefined),
    rename: vi.fn<AdHocWorkoutRepository['rename']>().mockResolvedValue(undefined),
    comment: vi.fn<AdHocWorkoutRepository['comment']>().mockResolvedValue(undefined),
    resolveTemplate: vi.fn<AdHocWorkoutRepository['resolveTemplate']>().mockResolvedValue(undefined),
    deleteExercise: vi.fn<AdHocWorkoutRepository['deleteExercise']>().mockResolvedValue(undefined),
  } satisfies AdHocSessionRepository;
  const view = render(<AdHocSessionScreen repository={repository} sessionId={session.sessionId}
    initData="signed" onNavigationContextChange={vi.fn()} />);
  return { ...view, observations, observe, addSet, complete, addExercises, repository };
}

afterEach(() => {
  cleanup();
  overlays.review.mockReset();
  overlays.finish = null;
  overlays.select = null;
});

describe('AdHocSessionScreen mutation and observation ownership', () => {
  it('ignores duplicate add-set taps while pending and accepts another after settlement', async () => {
    const { observations, addSet } = fixture();
    act(() => observations[0].next(session, row));
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    addSet.mockImplementationOnce(() => pending);
    const add = screen.getByRole('button', { name: 'Добавить подход' });

    // Same-turn taps exercise the synchronous guard before a busy rerender.
    act(() => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    await waitFor(() => expect(addSet).toHaveBeenCalledTimes(1));
    expect(addSet).toHaveBeenCalledWith('session-a1', 'exercise-x1');
    fireEvent.click(add);
    expect(addSet).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    // Check after settlement too: a duplicate must not have entered the queue.
    expect(addSet).toHaveBeenCalledTimes(1);
    fireEvent.click(add);
    await waitFor(() => expect(addSet).toHaveBeenCalledTimes(2));
    expect(addSet).toHaveBeenLastCalledWith('session-a1', 'exercise-x1');
  });

  it('closes an open finish confirmation on observer failure and rejects its stale confirmation callback', async () => {
    const { observations, complete, addSet, addExercises } = fixture();
    act(() => observations[0].next(session, row));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить тренировку' }));
    const dialog = screen.getByRole('dialog', { name: 'Завершить тренировку?' });
    expect(within(dialog).getByRole('button', { name: 'Завершить' })).toBeTruthy();
    const staleConfirm = overlays.finish;
    if (!staleConfirm) throw new Error('Missing finish confirmation callback');
    expect(complete).not.toHaveBeenCalled();

    // Invoke the old callback before React can rerender and unmount the overlay.
    await act(async () => {
      observations[0].error(new Error('Не удалось прочитать тренировку'));
      staleConfirm();
    });
    expect(screen.queryByRole('dialog', { name: 'Завершить тренировку?' })).toBeNull();
    expect(screen.queryByTestId('session-card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    // A retained callback must also remain harmless after the overlay unmounts.
    await act(async () => staleConfirm());
    expect(complete).not.toHaveBeenCalled();
    expect(addSet).not.toHaveBeenCalled();
    expect(addExercises).not.toHaveBeenCalled();
  });

  it('closes an open exercise selector on observer failure and rejects its stale selection callback', async () => {
    const { observations, complete, addSet, addExercises } = fixture();
    act(() => observations[0].next(session, row));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить упражнение' }));
    const dialog = screen.getByRole('dialog', { name: 'Выбор упражнений для тренировки' });
    expect(within(dialog).getByRole('button', { name: 'Добавить выбранные упражнения' })).toBeTruthy();
    const staleConfirm = overlays.select;
    if (!staleConfirm) throw new Error('Missing exercise selection callback');
    expect(addExercises).not.toHaveBeenCalled();

    await act(async () => {
      observations[0].error(new Error('Не удалось прочитать тренировку'));
      staleConfirm(['definition-d2']);
    });
    expect(screen.queryByRole('dialog', { name: 'Выбор упражнений для тренировки' })).toBeNull();
    expect(screen.queryByTestId('session-card')).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    await act(async () => staleConfirm(['definition-d2']));
    expect(addExercises).not.toHaveBeenCalled();
    expect(addSet).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('removes a loaded stale session after observer failure and resubscribes on retry', async () => {
    const { observations, observe, addSet } = fixture();
    act(() => observations[0].next(session, row));
    expect(screen.getByText('Исходная тренировка')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить подход' })).toBeTruthy();

    act(() => observations[0].error(new Error('Не удалось прочитать тренировку')));
    expect(screen.getByRole('alert').textContent).toBe('Не удалось прочитать тренировку');
    expect(screen.queryByTestId('session-card')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить подход' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    await waitFor(() => expect(observe).toHaveBeenCalledTimes(2));
    expect(observations[0].unsubscribe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls.map(([id]) => id)).toEqual(['session-a1', 'session-a1']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Загружаем тренировку…')).toBeTruthy();

    // A superseded subscription must not restore its old projection or error.
    act(() => {
      observations[0].next(session, row);
      observations[0].error(new Error('Устаревшая ошибка'));
    });
    expect(screen.queryByTestId('session-card')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // No metadata on the new read: verify the old header was cleared as well.
    act(() => observations[1].next(session));
    expect(screen.getByTestId('session-card')).toBeTruthy();
    expect(screen.getByText('Без названия')).toBeTruthy();
    expect(screen.queryByText('Исходная тренировка')).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить подход' })).toBeTruthy();
    expect(addSet).not.toHaveBeenCalled();
  });
});


it('shows the safe repository diagnosis when an observed session becomes unavailable', async () => {
  const { observations } = fixture();
  act(() => observations[0].next(null, undefined, 'ADHOC_INVALID_SOURCE'));
  expect(screen.getByRole('alert').textContent).toContain('ADHOC_INVALID_SOURCE');
  expect(screen.queryByTestId('session-card')).toBeNull();
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
});


it.each([null, 'occurrence-one'])('shows one deletion dialog matching session kind (occurrence=%s)', occurrenceId => {
  const { observations, repository } = fixture();
  act(() => observations[0].next({ ...session, occurrenceId }, row));
  fireEvent.click(screen.getByRole('button', { name: 'Удалить упражнение' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  if (occurrenceId) {
    const dialog = screen.getByRole('dialog', {
      name: 'Тренировка была запущена. Удаление из плана невозможно.',
    });
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.queryByText('Упражнение и его подходы будут удалены из этой тренировки.')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Понятно' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(repository.deleteExercise).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-card')).toBeTruthy();
  } else {
    expect(screen.getByRole('dialog', { name: 'Удалить упражнение?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy();
  }
});

it('requests review only after explicit completion commits, even if the session screen unmounts', async () => {
  const { observations, complete, unmount } = fixture();
  act(() => observations[0].next(session, row));
  expect(overlays.review).not.toHaveBeenCalled();
  let finish: () => void = () => {};
  complete.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Завершить тренировку' }));
  fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(overlays.review).not.toHaveBeenCalled();
  unmount();
  await act(async () => finish());
  expect(overlays.review).toHaveBeenCalledExactlyOnceWith('session-a1');
});
it('does not request overlap review when completion fails', async () => {
  const { observations, complete } = fixture();
  act(() => observations[0].next(session, row));
  complete.mockRejectedValueOnce(new Error('Не удалось завершить'));
  fireEvent.click(screen.getByRole('button', { name: 'Завершить тренировку' }));
  fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(overlays.review).not.toHaveBeenCalled();
});
