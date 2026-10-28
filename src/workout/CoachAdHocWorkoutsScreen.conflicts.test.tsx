// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { NavigationFloatingAction } from '../NavigationShell';
import type { ProgramWorkoutStartInput } from './PlannedWorkoutStartContext';
import { CoachAdHocWorkoutsScreen } from './CoachAdHocWorkoutsScreen';

const state = vi.hoisted(() => ({ action: null as NavigationFloatingAction | null,
  quick: vi.fn(), program: vi.fn(), directQuick: vi.fn(), directProgram: vi.fn(), dismiss: vi.fn(), conflict: false }));
vi.mock('../NavigationShell', () => ({ useNavigationFloatingAction: (_: string, action: NavigationFloatingAction | null) => { state.action = action; } }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: database, actorUserId: 'tg:101' }) }));
const database = {};
vi.mock('../data/cloud/adhoc-workouts', () => ({ AdHocWorkoutRepository: class {
  createQuick = state.directQuick; createForAthlete = state.directProgram;
  observeOpen(change: (rows: []) => void) { change([]); return { unsubscribe() {} }; }
} }));
vi.mock('./PlannedWorkoutStartContext', () => ({ usePlannedWorkoutStart: () => ({
  conflictActive: state.conflict, dismissConflict: state.dismiss, startQuick: state.quick, startFromProgram: state.program,
}) }));
vi.mock('konsta/react', () => ({ List: () => null, ListItem: () => null, Toast: () => null,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button> }));
vi.mock('../ui', () => ({ Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  MezfitDialog: () => null, MezfitDialogButton: () => null }));
vi.mock('./PlannedWorkoutsSheet', () => ({ PlannedWorkoutsSheet: () => null }));
vi.mock('./AdHocSessionScreen', () => ({ AdHocSessionScreen: ({ sessionId }: { sessionId: string }) => <div>Сессия {sessionId}</div> }));
vi.mock('../schedule/ScheduleWorkoutCreator', () => ({ ScheduleWorkoutCreator: ({ intent, suspended, onStartWorkout }: {
  intent: string | null; suspended: boolean; onStartWorkout: (input: ProgramWorkoutStartInput) => Promise<void>;
}) => intent ? <section aria-label="Выбранная программа" data-suspended={String(suspended)}>
  <button onClick={() => { void onStartWorkout({ athleteUserId: 'tg:202', programId: 'program', dayId: 'day' }); }}>Начать день</button>
</section> : null }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks(); state.conflict = false;
  state.quick.mockResolvedValue({ id: 'quick', createdProgram: false });
  state.program.mockResolvedValue({ id: 'program-session', createdProgram: false });
});
async function pick(id: string) {
  act(() => state.action?.popoverItems?.find(item => item.id === id)?.onSelect?.());
  await act(async () => state.action?.onPresentationChange?.(false));
}
it('routes quick Start through the shared conflict controller', async () => {
  render(<CoachAdHocWorkoutsScreen initData="" onNavigationContextChange={() => {}} />);
  await pick('quick');
  await screen.findByText('Сессия quick');
  expect(state.quick).toHaveBeenCalledWith(expect.any(Function));
  expect(state.directQuick).not.toHaveBeenCalled();
});
it('keeps the source selected but suspended during conflict resolution, then starts the same program day', async () => {
  let finish: ((result: { id: string; createdProgram: boolean }) => void) | undefined;
  state.program.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const navigation = vi.fn();
  const view = render(<CoachAdHocWorkoutsScreen initData="" onNavigationContextChange={navigation} />);
  await pick('program');
  fireEvent.click(screen.getByRole('button', { name: 'Начать день' }));
  state.conflict = true;
  view.rerender(<CoachAdHocWorkoutsScreen initData="" onNavigationContextChange={navigation} />);
  expect(screen.getByLabelText('Выбранная программа').getAttribute('data-suspended')).toBe('true');
  expect(navigation).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Конфликт тренировок', onBack: state.dismiss }));
  state.conflict = false;
  await act(async () => finish?.({ id: 'program-session', createdProgram: false }));
  await screen.findByText('Сессия program-session');
  expect(state.program).toHaveBeenCalledWith({ athleteUserId: 'tg:202', programId: 'program', dayId: 'day' }, expect.any(Function));
  expect(state.directProgram).not.toHaveBeenCalled();
  view.unmount();
  await waitFor(() => expect(state.dismiss).toHaveBeenCalled());
});
