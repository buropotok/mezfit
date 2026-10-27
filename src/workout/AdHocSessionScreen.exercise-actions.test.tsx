// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { AdHocSessionScreen, type AdHocSessionRepository } from './AdHocSessionScreen';
import type { WorkoutFactCardProps } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

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
  MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('./WorkoutSessionCard', () => ({
  WorkoutSessionCard: ({ session, onExerciseInformation, onDeleteExercise }: WorkoutFactCardProps<string>) =>
    <div>{session.exercises.map(exercise => <div key={exercise.sessionExerciseId}>
      <button onClick={() => onExerciseInformation?.(exercise.sessionExerciseId)}>Иконка упражнения</button>
      <button onClick={() => onDeleteExercise?.(exercise.sessionExerciseId)}>Удалить через меню</button>
    </div>)}</div>,
}));
vi.mock('./WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => null }));
vi.mock('../program/ProgramExerciseInformationSheet', () => ({
  ProgramExerciseInformationSheet: ({ load, onClose }: {
    load: () => Promise<unknown>; onClose: () => void;
  }) => <div role="dialog" aria-label="Информация об упражнении">
    <button onClick={() => { void load(); }}>Загрузить карточку</button>
    <button onClick={onClose}>Закрыть карточку</button>
  </div>,
}));

const workout: ActiveWorkoutSession<string> = {
  sessionId: 'session-1', occurrenceId: null, status: 'active',
  workoutDate: '2026-10-27', startedAt: null, completedAt: null,
  program: null, phase: null, day: null,
  exercises: [{
    sessionExerciseId: 'exercise-1', workoutSessionId: 'session-1',
    sourceProgramExerciseId: null, position: 0, status: 'active', notes: null, sets: [],
    exercise: {
      id: 'definition-1', name: 'Жим лёжа', scope: 'global', description: null,
      tracking_type: 'weight_reps', category_code: 'chest', equipment_code: 'barbell',
      reference_source: null, reference_key: null, reference_media_url: null,
      is_favourite: false, can_edit: false,
    },
  }],
};

afterEach(cleanup);

it('opens session exercise information and keeps deletion behind confirmation', async () => {
  let notify: Parameters<AdHocWorkoutRepository['observe']>[1] | null = null;
  const deleteExercise = vi.fn<AdHocWorkoutRepository['deleteExercise']>().mockResolvedValue(undefined);
  const repository = {
    actorUserId: 'tg:101',
    observe: vi.fn<AdHocWorkoutRepository['observe']>((_id, next) => {
      notify = next;
      return { unsubscribe: vi.fn() };
    }),
    deleteExercise,
    reorder: vi.fn<AdHocWorkoutRepository['reorder']>().mockResolvedValue(undefined),
    saveSet: vi.fn<AdHocWorkoutRepository['saveSet']>().mockResolvedValue(undefined),
    addSet: vi.fn<AdHocWorkoutRepository['addSet']>().mockResolvedValue(undefined),
    deleteSet: vi.fn<AdHocWorkoutRepository['deleteSet']>().mockResolvedValue(undefined),
    rename: vi.fn<AdHocWorkoutRepository['rename']>().mockResolvedValue(undefined),
    comment: vi.fn<AdHocWorkoutRepository['comment']>().mockResolvedValue(undefined),
    addExercises: vi.fn<AdHocWorkoutRepository['addExercises']>().mockResolvedValue(undefined),
    complete: vi.fn<AdHocWorkoutRepository['complete']>().mockResolvedValue(undefined),
    resolveTemplate: vi.fn<AdHocWorkoutRepository['resolveTemplate']>().mockResolvedValue(undefined),
  } satisfies AdHocSessionRepository;
  const information = vi.fn(async () => ({ row: null, taxonomy: [],
    name: 'Жим лёжа', mediaUrl: null }));
  render(<AdHocSessionScreen repository={repository} sessionId="session-1" initData="signed"
    onNavigationContextChange={vi.fn()} onExerciseInformation={information} />);
  act(() => notify?.(workout));

  fireEvent.click(screen.getByRole('button', { name: 'Иконка упражнения' }));
  const infoSheet = screen.getByRole('dialog', { name: 'Информация об упражнении' });
  fireEvent.click(within(infoSheet).getByRole('button', { name: 'Загрузить карточку' }));
  await waitFor(() => expect(information).toHaveBeenCalledWith('exercise-1'));
  expect(deleteExercise).not.toHaveBeenCalled();
  fireEvent.click(within(infoSheet).getByRole('button', { name: 'Закрыть карточку' }));

  fireEvent.click(screen.getByRole('button', { name: 'Удалить через меню' }));
  const dialog = screen.getByRole('dialog', { name: 'Удалить упражнение?' });
  expect(deleteExercise).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  expect(deleteExercise).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Удалить через меню' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Удалить упражнение?' }))
    .getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(deleteExercise).toHaveBeenCalledWith('session-1', 'exercise-1'));
});
