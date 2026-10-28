// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { WorkoutSessionCard, type WorkoutFactCardProps } from './WorkoutSessionCard';
import { SetEntry } from './SetEntry';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import type { SaveSessionSetInput, SessionExerciseProps } from './sessionExerciseTypes';
import type { SetEntryData } from './setEntryTypes';
import type { TrackingType } from '../api';

vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  type SortableListProps = React.ComponentProps<typeof actual.SortableList>;
  return {
    ...actual,
    SortableList: ({ items, header, footer, onReorder, disabled }: SortableListProps) => (
      <div>
        {header}
        <button disabled={disabled} onClick={() => onReorder([...items].reverse())}>Reverse exercises</button>
        {items.map(item => <div key={item.id}>{item.content}</div>)}
        {footer}
      </div>
    ),
  };
});

const session: ActiveWorkoutSession<string> = {
  sessionId: 'session-a1', occurrenceId: null, status: 'active',
  workoutDate: '2026-10-27', startedAt: null, completedAt: null,
  program: { id: 'program-p1', name: 'Силовой блок' }, phase: null, day: null,
  exercises: [{
    sessionExerciseId: 'exercise-x1', workoutSessionId: 'session-a1',
    sourceProgramExerciseId: 'source-x1', position: 0, status: 'active', notes: null,
    mediaUrl: '/snapshot/exercise-x1.jpg', showPreviousPlaceholder: true,
    exercise: {
      id: 'definition-d1', scope: 'global', name: 'Жим лёжа', description: null,
      tracking_type: 'weight_reps', category_code: 'chest', equipment_code: 'barbell',
      reference_source: null, reference_key: null, reference_media_url: null,
      is_favourite: false, can_edit: false,
    },
    sets: [{
      sessionSetId: 'set-s1', sourceProgramSetId: 'source-s1', position: 0, status: 'pending',
      plan: { weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      previous: null, fact: null,
    }],
  }, {
    sessionExerciseId: 'exercise-x2', workoutSessionId: 'session-a1',
    sourceProgramExerciseId: null, position: 1, status: 'active', notes: null,
    exercise: {
      id: 'definition-d2', scope: 'global', name: 'Присед', description: null,
      tracking_type: 'weight_reps', category_code: 'legs', equipment_code: 'barbell',
      reference_source: null, reference_key: null, reference_media_url: null,
      is_favourite: false, can_edit: false,
    },
    sets: [],
  }],
};

function editorData(trackingType: TrackingType): SetEntryData {
  return {
    identity: {
      programId: null, programName: null, exerciseDefinitionId: 'definition-d1',
      exerciseName: 'Жим лёжа', setNumber: 1, workoutDate: '2026-10-27',
      sourceProgramSetId: null, sessionSetId: 'set-s1',
    },
    trackingType, plan: null, previous: null, fact: null,
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkoutSessionCard string identities', () => {
  it('keeps legacy callback defaults and PLAN numeric', () => {
    expectTypeOf<ActiveWorkoutSession['sessionId']>().toEqualTypeOf<number>();
    expectTypeOf<SaveSessionSetInput['sessionSetId']>().toEqualTypeOf<number>();
    expectTypeOf<Parameters<WorkoutFactCardProps['onReorderExerciseIds']>[0]>().toEqualTypeOf<number[]>();
    expectTypeOf<Parameters<NonNullable<WorkoutFactCardProps<string>['onDeleteSet']>>[0]>().toEqualTypeOf<string>();
    type Plan = Extract<SessionExerciseProps<string>, { mode: 'plan' }>;
    expectTypeOf<Plan['data']['sessionExerciseId']>().toEqualTypeOf<number>();
    expectTypeOf<Parameters<NonNullable<Plan['onOpenHistory']>>[0]>().toEqualTypeOf<number>();
  });

  it('preserves numeric IDs for existing workout consumers', () => {
    const numericSession: ActiveWorkoutSession = {
      ...session, sessionId: 100, occurrenceId: null, program: null, phase: null, day: null,
      creator: undefined,
      exercises: session.exercises.map((exercise, index) => ({
        ...exercise, sessionExerciseId: 200 + index, workoutSessionId: 100,
        sourceProgramExerciseId: null, exercise: { ...exercise.exercise, id: 300 + index }, sets: [],
      })),
    };
    const onReorderExerciseIds = vi.fn<(ids: number[]) => void>();
    render(<WorkoutSessionCard session={numericSession} onReorderExerciseIds={onReorderExerciseIds}
      onSaveSet={async (_input: SaveSessionSetInput) => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reverse exercises' }));
    expect(onReorderExerciseIds).toHaveBeenCalledWith([201, 200]);
  });

  it('preserves alphanumeric IDs through reorder, exercise actions and the real SetEntry save', async () => {
    const onReorderExerciseIds = vi.fn<(ids: string[]) => void>();
    const onSaveSet = vi.fn(async (_input: SaveSessionSetInput<string>) => undefined);
    const onAddSet = vi.fn<(id: string) => void>();
    const onOpenExerciseMenu = vi.fn<(id: string) => void>();
    const onOpenExerciseHistory = vi.fn<(id: string) => void>();
    const { container } = render(<WorkoutSessionCard session={session}
      onReorderExerciseIds={onReorderExerciseIds} onSaveSet={onSaveSet}
      onAddSet={onAddSet} onOpenExerciseMenu={onOpenExerciseMenu}
      onOpenExerciseHistory={onOpenExerciseHistory} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reverse exercises' }));
    expect(onReorderExerciseIds).toHaveBeenCalledWith(['exercise-x2', 'exercise-x1']);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/snapshot/exercise-x1.jpg');
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    expect(screen.getByText('Пред.: —')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    expect(onAddSet).toHaveBeenCalledWith('exercise-x1');
    fireEvent.click(screen.getAllByRole('button', { name: 'Опции упражнения' })[0]);
    expect(onOpenExerciseMenu).toHaveBeenCalledWith('exercise-x1');
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    expect(screen.getByRole('dialog', { name: 'Подход 1' })).toBeTruthy();
    // A missing PREVIOUS remains null in SetEntry; the placeholder belongs to the row.
    expect(within(screen.getByRole('dialog', { name: 'Подход 1' })).queryByText('Пред.: —')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить подход' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'История упражнения' }));
    expect(onOpenExerciseHistory).toHaveBeenCalledWith('definition-d1');
    fireEvent.click(screen.getByRole('button', { name: 'Дропсет' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Подход 1' }))
      .getByRole('button', { name: 'Закрыть подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(onSaveSet).toHaveBeenCalledWith({
      workoutSessionId: 'session-a1', sessionExerciseId: 'exercise-x1', sessionSetId: 'set-s1',
      fact: {
        metrics: { weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
        setLabel: null, setType: 'dropset', rpe: null, comment: null, bands: [],
      },
    }));
  });

  it('deletes the selected string set and closes the editor only after success', async () => {
    let finish = () => {};
    const onDeleteSet = vi.fn((_id: string) => new Promise<void>(resolve => { finish = resolve; }));
    render(<WorkoutSessionCard session={session} onReorderExerciseIds={() => {}}
      onSaveSet={async () => {}} onDeleteSet={onDeleteSet} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход' }));
    expect(screen.getByText('Удалить подход?')).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Удалить' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(onDeleteSet).toHaveBeenCalledTimes(1);
    expect(onDeleteSet).toHaveBeenCalledWith('set-s1');
    expect(screen.getByRole('dialog', { name: 'Подход 1' })).toBeTruthy();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Подход 1' })).toBeNull());
  });

  it('does not add the previous placeholder when the projection opts out', () => {
    render(<WorkoutSessionCard session={{ ...session, exercises: session.exercises.map(exercise => ({
      ...exercise, showPreviousPlaceholder: undefined,
    })) }} onReorderExerciseIds={() => {}} onSaveSet={async () => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    expect(screen.queryByText('Пред.: —')).toBeNull();
  });
});

const trackingTypes: TrackingType[] = ['weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight'];
describe.each(trackingTypes)('SetEntry %s explicit deletion capability', trackingType => {
  it('guards pending deletes and saves, reports failure and allows retry', async () => {
    let rejectDelete: (reason: Error) => void = () => {};
    const onDeleteSet = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectDelete = reject; }));
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<SetEntry mode="workout" isOpen data={editorData(trackingType)}
      onSave={onSave} onClose={onClose} onDeleteSet={onDeleteSet} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход' }));
    const remove = screen.getByRole('button', { name: 'Удалить' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    const close = screen.getByRole('button', { name: 'Закрыть подход' });
    expect(close.hasAttribute('disabled')).toBe(true);
    fireEvent.click(close);
    expect(screen.queryByRole('alertdialog', { name: 'Сохранить изменения?' })).toBeNull();
    expect(onDeleteSet).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => rejectDelete(new Error('Повторите удаление')));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Повторите удаление');
    expect(onClose).not.toHaveBeenCalled();
    onDeleteSet.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDeleteSet).toHaveBeenCalledTimes(2);
  });

  it('hides deletion for read-only occurrence PLAN even with a callback', () => {
    const onDeleteSet = vi.fn(async () => {});
    render(<SetEntry mode="occurrence-plan" readOnly isOpen data={editorData(trackingType)}
      onPlanSave={async () => {}} onClose={() => {}} onDeleteSet={onDeleteSet} />);
    expect(screen.queryByRole('button', { name: 'Удалить подход' })).toBeNull();
    expect(onDeleteSet).not.toHaveBeenCalled();
  });
});
