// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdHocOpenSession } from '../data/cloud/adhoc-workouts';
import type { ActiveWorkoutSession } from './workoutSessionTypes';
import { ClientSharedWorkoutScreen } from './ClientSharedWorkoutScreen';

const state = vi.hoisted(() => ({
  emitList: null as ((rows: AdHocOpenSession[]) => void) | null,
  emitError: null as (() => void) | null,
  emitDetail: null as ((value: ActiveWorkoutSession<string> | null, row?: { name: string }) => void) | null,
  unsubscribeList: vi.fn(),
  unsubscribeDetail: vi.fn(),
}));
const cloud = { db: {}, actorUserId: 'tg:202' };

vi.mock('../schedule/WorkoutPerson', () => ({ useWorkoutPerson: () => ({ name: 'Атлет', avatar: <span>Фото атлета</span>, compactAvatar: null }) }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => cloud,
}));
vi.mock('../data/cloud/adhoc-workouts', () => ({
  AdHocWorkoutRepository: class {
    observeForClient(callback: (rows: AdHocOpenSession[]) => void, onError: () => void) {
      state.emitList = callback;
      state.emitError = onError;
      return { unsubscribe: state.unsubscribeList };
    }
    observe(_id: string, callback: (value: ActiveWorkoutSession<string> | null, row?: { name: string }) => void) {
      state.emitDetail = callback;
      return { unsubscribe: state.unsubscribeDetail };
    }
  },
}));
vi.mock('konsta/react', () => ({
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, onClick }: { title: string; onClick: () => void }) =>
    <button onClick={onClick}>{title}</button>,
}));
vi.mock('../ui', () => ({
  Text: ({ children, role }: { children: ReactNode; role?: string }) => <span role={role}>{children}</span>,
}));
vi.mock('./WorkoutSessionCard', () => ({
  WorkoutSessionCard: ({ session, readOnly }: {
    session: ActiveWorkoutSession<string>; readOnly?: boolean;
  }) => <div data-testid="shared-fact" data-read-only={readOnly ? 'true' : 'false'}>
    {session.exercises[0]?.sets[0]?.fact?.metrics.weightKg ?? '—'}
  </div>,
}));

function emit(rows: AdHocOpenSession[]) {
  act(() => state.emitList?.(rows));
}
const active = (id: string): AdHocOpenSession => ({ id, name: 'Тренировка клиента', status: 'active' });
function factSession(weight: number): ActiveWorkoutSession<string> {
  return {
    sessionId: 'shared-1', occurrenceId: null, status: 'active', workoutDate: '2026-10-27',
    startedAt: null, completedAt: null, program: null, phase: null, day: null,
    exercises: [{
      sessionExerciseId: 'exercise-1', workoutSessionId: 'shared-1',
      sourceProgramExerciseId: null, position: 0, status: 'active', notes: null,
      exercise: {
        id: 'definition-1', scope: 'global', name: 'Жим лёжа',
        description: null, tracking_type: 'weight_reps', category_code: 'chest',
        equipment_code: 'barbell', reference_source: null, reference_key: null,
        reference_media_url: null, is_favourite: false, can_edit: false,
      },
      sets: [{
        sessionSetId: 'set-1', sourceProgramSetId: null, position: 0, status: 'completed',
        plan: null, previous: null,
        fact: {
          metrics: { weightKg: weight, reps: 19, durationSeconds: null, distanceMeters: null },
          setLabel: null, rpe: null, comment: null, bands: [],
        },
      }],
    }],
  };
}
const renderScreen = () => render(<ClientSharedWorkoutScreen
  onNavigationContextChange={() => {}} legacy={<p>Старая тренировка</p>} />);

beforeEach(() => {
  vi.clearAllMocks();
  state.emitList = null; state.emitError = null; state.emitDetail = null;
});
afterEach(cleanup);

describe('client Training tab displays Coach-owned FACT', () => {
  it('keeps the old screen without shared FACT and switches to a live read-only view when it arrives', () => {
    renderScreen();
    expect(screen.getByText('Загружаем тренировки…')).toBeTruthy();
    emit([]);
    expect(screen.getByText('Старая тренировка')).toBeTruthy();

    emit([active('shared-1')]);
    expect(screen.queryByText('Старая тренировка')).toBeNull();
    act(() => state.emitDetail?.(factSession(57), { name: 'Тренировка клиента' }));
    expect(screen.getByTestId('shared-fact').textContent).toContain('57');
    expect(screen.getByTestId('shared-fact').getAttribute('data-read-only')).toBe('true');

    act(() => state.emitDetail?.(factSession(62), { name: 'Тренировка клиента' }));
    expect(screen.getByTestId('shared-fact').textContent).toContain('62');
    emit([]);
    expect(screen.queryByTestId('shared-fact')).toBeNull();
    expect(screen.getByText('Старая тренировка')).toBeTruthy();
  });

  it('lets the client choose between authorized simultaneous Coach sessions', () => {
    renderScreen();
    emit([active('shared-1'), { id: 'shared-2', name: 'Вторая тренировка', status: 'active' }]);
    expect(screen.getByRole('button', { name: 'Вторая тренировка' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Вторая тренировка' }));
    expect(state.unsubscribeDetail).toHaveBeenCalled();
  });

  it('does not block the previous client workout when shared FACT observation fails', () => {
    renderScreen();
    act(() => state.emitError?.());
    expect(screen.getByText('Старая тренировка')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Не удалось прочитать тренировки');
  });

  it('unsubscribes when the Training screen is closed', () => {
    const view = renderScreen();
    emit([active('shared-1')]);
    view.unmount();
    expect(state.unsubscribeList).toHaveBeenCalledTimes(1);
    expect(state.unsubscribeDetail).toHaveBeenCalledTimes(1);
  });
});
