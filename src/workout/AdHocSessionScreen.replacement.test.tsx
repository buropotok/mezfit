// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AdHocWorkoutRepository } from '../data/cloud/adhoc-workouts';
import { AdHocSessionScreen, type AdHocSessionRepository } from './AdHocSessionScreen';
import type { WorkoutFactCardProps } from './WorkoutSessionCard';
import type { ActiveWorkoutSession } from './workoutSessionTypes';

vi.mock('../schedule/WorkoutPerson', () => ({
  useWorkoutPerson: () => ({ name: 'Атлет', avatar: null, compactAvatar: null }),
}));
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
  }) => opened ? <div role="dialog" aria-label={String(title)}>{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
vi.mock('./WorkoutSessionCard', () => ({
  WorkoutSessionCard: ({ onReplaceExercise }: WorkoutFactCardProps<string>) =>
    <button onClick={() => onReplaceExercise?.('exercise-a')}>Меню: Заменить</button>,
}));
vi.mock('./WorkoutExerciseSelectionSheet', () => ({
  WorkoutExerciseSelectionSheet: ({ opened, mode, saving, onConfirm }: {
    opened?: boolean; mode?: string; saving?: boolean; onConfirm: (ids: string[]) => void;
  }) => opened ? <div role="dialog" aria-label="Выбор упражнения" data-mode={mode}>
    <button disabled={saving} onClick={() => onConfirm(['0002'])}>Выбрать новое</button>
  </div> : null,
}));
const session: ActiveWorkoutSession<string> = {
  sessionId: 'session-a', occurrenceId: null, status: 'active', workoutDate: '2026-11-19',
  startedAt: null, completedAt: null, program: null, phase: null, day: null,
  exercises: [{
    sessionExerciseId: 'exercise-a', workoutSessionId: 'session-a',
    sourceProgramExerciseId: null, position: 0, status: 'active', notes: null, sets: [],
    exercise: { id: '0001', name: 'Первое', scope: 'global', description: null,
      tracking_type: 'weight_reps', category_code: null, equipment_code: null,
      reference_source: null, reference_key: null, reference_media_url: null,
      is_favourite: false, can_edit: false },
  }],
};
const row = {
  id: 'session-a', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
  coachUserId: null, clientUserId: null, creatorUserId: 'tg:101',
  name: 'Тренировка', comment: null, programName: null, autoCreatedProgram: false,
  status: 'active' as const, startedAt: '2026-11-19T10:00:00.000Z', completedAt: null,
  createdAt: '2026-11-19T10:00:00.000Z', updatedAt: '2026-11-19T10:00:00.000Z',
};
function fixture(type: 'weight_reps' | 'time') {
  let notify: Parameters<AdHocWorkoutRepository['observe']>[1] | null = null;
  const replaceExercise = vi.fn<AdHocWorkoutRepository['replaceExercise']>().mockResolvedValue(undefined);
  const repository = {
    actorUserId: 'tg:101',
    observe: vi.fn<AdHocWorkoutRepository['observe']>((_id, next) => {
      notify = next;
      return { unsubscribe: vi.fn() };
    }),
    replacementTrackingType: vi.fn<AdHocWorkoutRepository['replacementTrackingType']>()
      .mockResolvedValue(type),
    replaceExercise,
    addExercises: vi.fn<AdHocWorkoutRepository['addExercises']>().mockResolvedValue(undefined),
    deleteExercise: vi.fn<AdHocWorkoutRepository['deleteExercise']>().mockResolvedValue(undefined),
    reorder: vi.fn<AdHocWorkoutRepository['reorder']>().mockResolvedValue(undefined),
    saveSet: vi.fn<AdHocWorkoutRepository['saveSet']>().mockResolvedValue(undefined),
    addSet: vi.fn<AdHocWorkoutRepository['addSet']>().mockResolvedValue(undefined),
    deleteSet: vi.fn<AdHocWorkoutRepository['deleteSet']>().mockResolvedValue(undefined),
    rename: vi.fn<AdHocWorkoutRepository['rename']>().mockResolvedValue(undefined),
    comment: vi.fn<AdHocWorkoutRepository['comment']>().mockResolvedValue(undefined),
    complete: vi.fn<AdHocWorkoutRepository['complete']>().mockResolvedValue(undefined),
    resolveTemplate: vi.fn<AdHocWorkoutRepository['resolveTemplate']>().mockResolvedValue(undefined),
  } satisfies AdHocSessionRepository;
  render(<AdHocSessionScreen repository={repository} sessionId="session-a" initData="signed"
    onNavigationContextChange={vi.fn()} />);
  act(() => notify?.(session, row));
  return replaceExercise;
}
afterEach(cleanup);

it('asks to preserve compatible FACT and forwards the answer to the repository', async () => {
  const replaceExercise = fixture('weight_reps');
  fireEvent.click(screen.getByRole('button', { name: 'Меню: Заменить' }));
  const picker = screen.getByRole('dialog', { name: 'Выбор упражнения' });
  expect(picker.getAttribute('data-mode')).toBe('replace');
  fireEvent.click(within(picker).getByRole('button', { name: 'Выбрать новое' }));
  const decision = await screen.findByRole('dialog', { name: 'Сохранить введённые данные?' });
  expect(replaceExercise).not.toHaveBeenCalled();
  fireEvent.click(within(decision).getByRole('button', { name: 'Да' }));
  await waitFor(() => expect(replaceExercise).toHaveBeenCalledWith('session-a', 'exercise-a', '0002', true));
});

it('discards incompatible FACT only after affirmative confirmation', async () => {
  const replaceExercise = fixture('time');
  fireEvent.click(screen.getByRole('button', { name: 'Меню: Заменить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать новое' }));
  const decision = await screen.findByRole('dialog', { name: 'Сделать замену?' });
  fireEvent.click(within(decision).getByRole('button', { name: 'Нет' }));
  expect(replaceExercise).not.toHaveBeenCalled();
});
