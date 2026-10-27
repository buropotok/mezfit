// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigationContext, NavigationFloatingAction } from '../NavigationShell';
import { CoachAdHocWorkoutsScreen } from './CoachAdHocWorkoutsScreen';

const state = vi.hoisted(() => ({
  action: null as NavigationFloatingAction | null,
  createQuick: vi.fn(), createForAthlete: vi.fn(), listPrograms: vi.fn(),
  unsubscribe: vi.fn(), rows: [] as { id: string; name: string; status: 'active' | 'completed' }[],
}));
vi.mock('../NavigationShell', () => ({
  useNavigationFloatingAction: (_destination: string, action: NavigationFloatingAction | null) => { state.action = action; },
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => cloud,
}));
const cloud = { db: {}, actorUserId: 'tg:101', clients: [{ userId: 'tg:202', displayName: 'Клиент' }], status: 'ready' };
vi.mock('../data/cloud/adhoc-workouts', () => ({
  AdHocWorkoutRepository: class {
    actorUserId = 'tg:101';
    createQuick = state.createQuick;
    createForAthlete = state.createForAthlete;
    listPrograms = state.listPrograms;
    observeOpen(onChange: (rows: typeof state.rows) => void) {
      onChange(state.rows); return { unsubscribe: state.unsubscribe };
    }
  },
}));
vi.mock('konsta/react', () => ({
  List: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ListItem: ({ title, onClick }: { title: string; onClick: () => void }) => <button onClick={onClick}>{title}</button>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  Toast: ({ opened, children }: { opened: boolean; children?: ReactNode }) => opened ? <div role="status">{children}</div> : null,
}));
vi.mock('../ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  MezfitDialog: ({ opened, title, children, buttons }: { opened: boolean; title: string; children?: ReactNode; buttons?: ReactNode }) =>
    opened ? <div role="dialog" aria-label={title}>{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick, disabled }: { children?: ReactNode; onClick: () => void; disabled?: boolean }) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
  MezfitBottomSheet: ({ opened, label, children }: { opened: boolean; label: string; children?: ReactNode }) =>
    opened ? <div role="dialog" aria-label={label}>{children}</div> : null,
}));
vi.mock('../schedule/ScheduleWorkoutCreator', () => ({
  ScheduleWorkoutCreator: ({ intent, mode, onStartWorkout }: {
    intent: string | null; mode: string;
    onStartWorkout: (input: { athleteUserId: string; programId?: string; dayId?: string }) => Promise<void>;
  }) => intent ? <div role="dialog" aria-label="Общий выбор программы" data-mode={mode}>
    <button onClick={() => void onStartWorkout({ athleteUserId: 'tg:101', programId: 'program-one', dayId: 'day-one' })}>Начать тренировку</button>
    <button onClick={() => void onStartWorkout({ athleteUserId: 'tg:202' })}>Клиент без программы</button>
  </div> : null,
}));
vi.mock('./AdHocSessionScreen', () => ({
  AdHocSessionScreen: ({ sessionId }: { sessionId: string }) => <div>Сессия {sessionId}</div>,
}));

async function pick(id: string) {
  act(() => {
    const item = state.action?.popoverItems?.find(item => item.id === id);
    if (!item) throw new Error('Missing workout action');
    item.onSelect?.();
  });
  await act(async () => { state.action?.onPresentationChange?.(false); });
}
const renderScreen = () => render(<CoachAdHocWorkoutsScreen initData="signed"
  onNavigationContextChange={() => {}} />);
beforeEach(() => {
  vi.clearAllMocks(); state.action = null; state.rows = [];
  cloud.db = {};
  state.createQuick.mockResolvedValue({ id: 'quick-one', createdProgram: false });
  state.createForAthlete.mockResolvedValue({ id: 'from-one', createdProgram: false });
  state.listPrograms.mockResolvedValue([{ id: 'program-one', name: 'Программа' }]);
});
afterEach(cleanup);

describe('Coach ad-hoc entry points', () => {
  it('starts quick immediately without querying or creating a program', async () => {
    renderScreen(); await pick('quick');
    expect(await screen.findByText('Сессия quick-one')).toBeTruthy();
    expect(state.createQuick).toHaveBeenCalledTimes(1);
    expect(state.listPrograms).not.toHaveBeenCalled();
    expect(state.createForAthlete).not.toHaveBeenCalled();
    expect(screen.queryByText('Была создана программа.')).toBeNull();
  });
  it('starts a selected own program day with stable string provenance', async () => {
    renderScreen(); await pick('program');
    fireEvent.click(await screen.findByText('Начать тренировку'));
    await waitFor(() => expect(state.createForAthlete).toHaveBeenCalledWith('tg:101', 'program-one', 'day-one'));
    expect(await screen.findByText('Сессия from-one')).toBeTruthy();
  });
  it('skips the program list when absent and shows the automatic-program toast', async () => {
    state.listPrograms.mockResolvedValue([]);
    state.createForAthlete.mockResolvedValue({ id: 'auto-one', createdProgram: true });
    renderScreen(); await pick('program');
    fireEvent.click(screen.getByText('Клиент без программы'));
    expect(await screen.findByText('Сессия auto-one')).toBeTruthy();
    expect(state.createForAthlete).toHaveBeenCalledWith('tg:202', undefined, undefined);
    expect(screen.getByText('Была создана программа.')).toBeTruthy();
    expect(screen.queryByText('Начать тренировку')).toBeNull();
  });
  it('opens only the empty planned sheet without a session mutation', async () => {
    renderScreen(); await pick('planned');
    expect(screen.getByRole('dialog', { name: 'Плановая тренировка' }).childElementCount).toBe(0);
    expect(state.createQuick).not.toHaveBeenCalled();
    expect(state.createForAthlete).not.toHaveBeenCalled();
    expect(state.listPrograms).not.toHaveBeenCalled();
  });
  it('ignores a late creation completion after the screen unmounts', async () => {
    let resolve: (value: { id: string; createdProgram: boolean }) => void = () => {};
    state.createQuick.mockImplementation(() => new Promise(value => { resolve = value; }));
    const view = renderScreen(); await pick('quick');
    view.unmount();
    await act(async () => resolve({ id: 'late', createdProgram: false }));
    expect(screen.queryByText('Сессия late')).toBeNull();
    expect(state.unsubscribe).toHaveBeenCalled();
  });
  it('keeps an active workout at the root and blocks + without opening a creation menu', async () => {
    const navigation = vi.fn();
    render(<CoachAdHocWorkoutsScreen initData="signed" onNavigationContextChange={navigation} />);
    await pick('quick');
    expect(await screen.findByText('Сессия quick-one')).toBeTruthy();
    expect(navigation.mock.calls.every(([value]) => value === null)).toBe(true);
    expect(state.action?.popoverItems).toBeUndefined();
    act(() => state.action?.onClick?.());
    expect(screen.getByRole('dialog', { name: 'Завершите текущую тренировку, чтобы начать новую.' })).toBeTruthy();
    expect(state.createQuick).toHaveBeenCalledTimes(1);
    expect(state.createForAthlete).not.toHaveBeenCalled();
  });
  it('resumes an active session after reopening the Training tab', async () => {
    state.rows = [{ id: 'resumed', name: 'День', status: 'active' }];
    renderScreen();
    expect(await screen.findByText('Сессия resumed')).toBeTruthy();
    expect(state.action?.popoverItems).toBeUndefined();
    expect(state.createQuick).not.toHaveBeenCalled();
  });
  it('reuses the shared source flow without a parent-render update loop', async () => {
    function Parent() {
      const [, setNavigation] = useState<NavigationContext | null>(null);
      return <CoachAdHocWorkoutsScreen initData="signed" onNavigationContextChange={setNavigation} />;
    }
    render(<Parent />); await pick('program');
    expect(screen.getByRole('dialog', { name: 'Общий выбор программы' }).getAttribute('data-mode')).toBe('start');
  });
  it('releases stale creation ownership when the repository is replaced', async () => {
    let resolve: (value: { id: string; createdProgram: boolean }) => void = () => {};
    state.createQuick.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const view = renderScreen(); await pick('quick');
    cloud.db = {};
    view.rerender(<CoachAdHocWorkoutsScreen initData="signed" onNavigationContextChange={() => {}} />);
    state.createQuick.mockResolvedValueOnce({ id: 'fresh', createdProgram: false });
    await pick('quick');
    expect(await screen.findByText('Сессия fresh')).toBeTruthy();
    await act(async () => resolve({ id: 'stale', createdProgram: true }));
    expect(screen.queryByText('Сессия stale')).toBeNull();
    expect(screen.queryByText('Была создана программа.')).toBeNull();
  });
});
