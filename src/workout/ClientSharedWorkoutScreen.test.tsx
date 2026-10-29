// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdHocOpenSession } from '../data/cloud/adhoc-workouts';
import type { UpcomingPlannedWorkout } from '../data/cloud/planned-workouts';
import type { OccurrenceDraftCardProps } from '../schedule/OccurrenceDraftSheet';
import { ClientSharedWorkoutScreen } from './ClientSharedWorkoutScreen';

const state = vi.hoisted(() => ({ db: {}, repository: { exerciseInformation: vi.fn() }, sessions: [] as AdHocOpenSession[],
  startQuick: vi.fn(), start: vi.fn(), showSession: vi.fn(),
  upcomingNext: null as ((rows: UpcomingPlannedWorkout[]) => void) | null,
  unsubscribe: vi.fn(), cards: [] as OccurrenceDraftCardProps[], catalogueRole: '', sessionRepository: null as unknown,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: state.db, actorUserId: 'tg:202' }) }));
vi.mock('./ClientWorkoutContext', () => ({ useClientWorkout: () => ({ repository: state.repository,
  sessions: state.sessions, loaded: true, error: '', retry: vi.fn() }) }));
vi.mock('./PlannedWorkoutStartContext', () => ({ usePlannedWorkoutStart: () => ({ startQuick: state.startQuick,
  start: state.start, showSession: state.showSession }) }));
vi.mock('../data/cloud/planned-workouts', () => ({ PlannedWorkoutsRepository: class {
  drafts = {};
  observe(_date: Date, next: typeof state.upcomingNext) { state.upcomingNext = next; return { unsubscribe: state.unsubscribe }; }
} }));
vi.mock('../schedule/OccurrenceDraftSheet', () => ({ OccurrenceDraftCard: (props: OccurrenceDraftCardProps) => {
  state.cards.push(props);
  return <button onClick={() => { if (props.draft) void props.onStart?.(props.draft).catch(() => undefined); }}>Start planned</button>;
} }));
vi.mock('./AdHocSessionScreen', () => ({ AdHocSessionScreen: ({ sessionId, personalCatalogueRole, repository }: {
  sessionId: string; personalCatalogueRole: string; repository: unknown;
}) => { state.catalogueRole = personalCatalogueRole; state.sessionRepository = repository;
  return <span>Session {sessionId}</span>; } }));
vi.mock('../ui', () => ({ Text: ({ children, role }: { children: ReactNode; role?: string }) => <span role={role}>{children}</span> }));
vi.mock('konsta/react', () => ({
  List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
  Button: ({ children, onClick, disabled }: {
  children: ReactNode; onClick: () => void; disabled?: boolean;
}) => <button onClick={onClick} disabled={disabled}>{children}</button> }));
const navigation = vi.fn();
const props = { initData: '', onNavigationContextChange: navigation };
const planned: UpcomingPlannedWorkout = { id: 'occurrence', programName: 'Программа', draft: {
  id: 'draft:occurrence', targetOccurrenceId: 'occurrence', actorUserId: 'tg:202', realmId: 'shared',
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'independent',
  startsAtUtc: '2026-10-29T08:00:00.000Z', durationMinutes: 60, saved: true,
  plan: { name: 'День', comment: null, exercises: [] }, originalPlan: { name: 'День', comment: null, exercises: [] },
  createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
} };
beforeEach(() => {
  state.sessions = []; state.cards = []; state.upcomingNext = null; state.sessionRepository = null;
  state.startQuick.mockReset().mockResolvedValue({ id: 'own', createdProgram: false });
  state.start.mockReset().mockResolvedValue('planned-session'); state.showSession.mockReset(); state.unsubscribe.mockClear();
});
afterEach(cleanup);
describe('Client local workout screen', () => {
  it('opens the existing Coach FACT through the athlete repository and Client catalogue', () => {
    state.sessions = [{ id: 'coach-session', name: 'С тренером', status: 'active' }];
    render(<ClientSharedWorkoutScreen {...props} />);
    expect(screen.getByText('Session coach-session')).toBeTruthy();
    expect(state.sessionRepository).toBe(state.repository);
    expect(state.catalogueRole).toBe('client');
    expect(screen.queryByText('Своя тренировка')).toBeNull();
    expect(state.startQuick).not.toHaveBeenCalled();
  });
  it('keeps selection between authorized pre-existing simultaneous Coach sessions', () => {
    state.sessions = [{ id: 'first', name: 'Первая', status: 'active' }, { id: 'second', name: 'Вторая', status: 'active' }];
    render(<ClientSharedWorkoutScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Вторая' }));
    expect(screen.getByText('Session second')).toBeTruthy();
    expect(screen.queryByText('Своя тренировка')).toBeNull();
  });
  it('starts an own workout and shows the accepted session without REST or program creation', async () => {
    render(<ClientSharedWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Своя тренировка'));
    expect(await screen.findByText('Session own')).toBeTruthy();
    expect(state.startQuick).toHaveBeenCalledOnce();
    expect(state.showSession).toHaveBeenCalledWith('own');
  });
  it('starts a published plan while keeping its prescription read-only', async () => {
    render(<ClientSharedWorkoutScreen {...props} />);
    act(() => state.upcomingNext?.([planned]));
    expect(state.cards.at(-1)).toMatchObject({ readOnly: true, allowReadOnlyStart: true });
    fireEvent.click(screen.getByText('Start planned'));
    expect(await screen.findByText('Session planned-session')).toBeTruthy();
    expect(state.start).toHaveBeenCalledWith(planned.draft);
  });
  it('retains the launch choices and reports an unavailable execution grant', async () => {
    state.startQuick.mockRejectedValue(new Error('CLIENT_EXECUTION_ACL_REQUIRED'));
    render(<ClientSharedWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Своя тренировка'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Запись результатов пока недоступна. Попробуйте позже.');
    expect(screen.getByText('Своя тренировка')).toBeTruthy();
    expect(state.showSession).not.toHaveBeenCalled();
  });
  it('suppresses navigation after leaving during local Start acceptance', async () => {
    let resolve!: (value: { id: string }) => void;
    state.startQuick.mockReturnValue(new Promise(value => { resolve = value; }));
    const view = render(<ClientSharedWorkoutScreen {...props} />);
    fireEvent.click(screen.getByText('Своя тренировка'));
    view.unmount();
    await act(async () => resolve({ id: 'accepted' }));
    await waitFor(() => expect(state.showSession).not.toHaveBeenCalled());
  });
});
