// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetails } from '../data/cloud/program-management';
import { ScheduleWorkoutCreator } from './ScheduleWorkoutCreator';

const state = vi.hoisted(() => ({
  list: vi.fn(), observe: vi.fn(), observeSync: vi.fn(), openDraft: vi.fn(),
  createBlank: vi.fn(), createFromProgramDay: vi.fn(), mutate: vi.fn(),
  floating: null as unknown, db: {},
}));
vi.mock('../NavigationShell', () => ({
  useNavigationSurfaceFloatingAction: (action: unknown) => { state.floating = action; },
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: state.db, actorUserId: 'coach', clients: [], coaches: [],
    status: 'ready', error: '', syncStatus: 'offline', syncError: '', refresh: vi.fn(), retrySync: vi.fn() }),
}));
vi.mock('../data/cloud/workout-planning', () => ({
  WorkoutPlanningRepository: class {
    actorUserId = 'coach';
    programs = { actorUserId: 'coach', listForScheduling: state.list,
      observeDetails: state.observe, observeAthleteDetails: state.observe, observeSync: state.observeSync,
      renamePhase: state.mutate, publishPhase: state.mutate, editDay: state.mutate,
      createPhase: state.mutate, addExerciseSet: state.mutate, activate: state.mutate };
    createBlank = state.createBlank;
    createFromProgramDay = state.createFromProgramDay;
  },
}));
vi.mock('../schedule/SchedulePlanningContext', () => ({
  useSchedulePlanning: () => ({ openDraft: state.openDraft }),
}));
vi.mock('../program/ProgramClientPicker', () => ({
  ProgramClientPicker: ({ opened, onSelect }: { opened: boolean; onSelect: (client: { userId: string }) => void }) =>
    opened ? <button onClick={() => onSelect({ userId: 'client' })}>Выбрать Анну</button> : null,
}));
vi.mock('konsta/react', async original => {
  const actual = await original<typeof import('konsta/react')>();
  return { ...actual,
    Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      <button onClick={onClick} disabled={disabled}>{children}</button>,
    Toast: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div role="status">{children}</div> : null,
    List: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ListItem: ({ title, media, after, onClick }: { title: string; media?: ReactNode; after?: ReactNode; onClick: () => void }) =>
      <div>{media}<button onClick={onClick}>{title} {after}</button></div>,
  };
});
vi.mock('../ui', async original => {
  const actual = await original<typeof import('../ui')>();
  return { ...actual,
    MezfitBottomSheet: ({ opened, children }: { opened: boolean; children: ReactNode }) => opened ? <div>{children}</div> : null,
    MezfitDialog: ({ opened, children, buttons }: { opened: boolean; children?: ReactNode; buttons?: ReactNode }) =>
      opened ? <div>{children}{buttons}</div> : null,
    MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
      <button onClick={onClick} disabled={disabled}>{children}</button>,
    SortableList: ({ items, header, footer }: React.ComponentProps<typeof actual.SortableList>) =>
      <div>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
    LiquidPopover: ({ trigger, label, items = [], onPresentationChange }: React.ComponentProps<typeof actual.LiquidPopover>) =>
      <div>{trigger}<div role="menu" aria-label={label}>
        {items.map(item => <button key={item.id} disabled={item.disabled} onClick={item.onSelect}>{item.label}</button>)}
        <button onClick={() => onPresentationChange?.(false)}>Закрыть меню</button>
      </div></div>,
  };
});

const details: ProgramDetails = {
  program: { id: 'program', realmId: 'coach', owner: 'coach', athleteUserId: 'coach', coachUserId: null,
    clientUserId: null, name: 'Силовая программа', position: 0, status: 'draft', startedAt: null,
    finishedAt: null, createdAt: '', updatedAt: '' },
  phases: [{ id: 'phase', realmId: 'coach', owner: 'coach', trainingPlanId: 'program', name: 'Первая фаза',
    position: 0, status: 'draft', durationWeeks: 6, plannedStartDate: null, plannedEndDate: null }],
  days: [{ day: { id: 'day', realmId: 'coach', owner: 'coach', programPhaseId: 'phase',
    name: 'День А', position: 0, status: 'active', comment: 'Комментарий дня' }, exercises: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.floating = null;
  state.list.mockResolvedValue([details.program]);
  state.observe.mockImplementation((_id: string, next: (value: ProgramDetails) => void) => {
    next(details); return { unsubscribe: vi.fn() };
  });
  state.observeSync.mockImplementation(() => ({ unsubscribe: vi.fn() }));
});
afterEach(cleanup);

function setup(onStartWorkout = vi.fn(async () => {})) {
  const onCreated = vi.fn();
  render(<ScheduleWorkoutCreator intent="workout" role="coach" mode="start" actor={{ name: 'Мария' }}
    onStartWorkout={onStartWorkout} onClose={vi.fn()} onCreated={onCreated} onNavigationContextChange={vi.fn()} />);
  return { onStartWorkout, onCreated };
}

async function openDetails(client = false) {
  if (client) {
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать клиента' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать Анну' }));
  } else fireEvent.click(screen.getByRole('button', { name: 'Моя тренировка' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Силовая программа Черновик' }));
  return screen.findByRole('article', { name: 'День День А' });
}

function noCalendarWrites() {
  expect(state.createBlank).not.toHaveBeenCalled();
  expect(state.createFromProgramDay).not.toHaveBeenCalled();
  expect(state.openDraft).not.toHaveBeenCalled();
}

describe('start mode reuses the complete calendar source flow', () => {
  it('keeps the real details, summary, sync controls, phase disclosure and day contents', async () => {
    const { onStartWorkout, onCreated } = setup();
    const card = await openDetails();
    expect(state.list).toHaveBeenCalledWith('coach');
    expect(screen.getByRole('region', { name: 'Программа Силовая программа' })).toBeTruthy();
    expect(screen.getByText('Описание программы')).toBeTruthy();
    expect(screen.getByText('Владелец: Мария')).toBeTruthy();
    expect(screen.getByLabelText('Аватар владельца: Мария')).toBeTruthy();
    expect(screen.getByText('Атлет: Мария')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Синхронизировать' })).toBeTruthy();
    expect(screen.getByText('6 недель')).toBeTruthy();
    const disclosure = screen.getByRole('button', { name: 'Свернуть фазу Первая фаза' });
    fireEvent.click(disclosure);
    expect(screen.getByRole('button', { name: 'Развернуть фазу Первая фаза' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть фазу Первая фаза' }));
    expect(within(card).getByText('Комментарий дня')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Запланировать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать с нуля' })).toBeNull();
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    expect(state.floating).toBeNull();
    const start = within(card).getByRole('button', { name: 'Начать тренировку' });
    expect(start.parentElement?.classList.contains('workout-plan-card__actions--start')).toBe(true);
    fireEvent.click(start);
    await waitFor(() => expect(onStartWorkout).toHaveBeenCalledWith({ athleteUserId: 'coach', programId: 'program', dayId: 'day' }));
    expect(onCreated).not.toHaveBeenCalled();
    noCalendarWrites();
  });

  it('keeps source menus visible and explains blocked edits without source writes', async () => {
    const { onStartWorkout } = setup();
    const card = await openDetails();
    const phaseMenu = screen.getByRole('menu', { name: 'Действия с фазой Первая фаза' });
    fireEvent.click(within(phaseMenu).getByRole('button', { name: 'Переименовать' }));
    expect(screen.getByText('Нажмите Начать тренировку, чтобы начать изменение плана тренировки')).toBeTruthy();
    const dayMenu = within(card).getByRole('menu', { name: 'Меню дня День А' });
    fireEvent.click(within(dayMenu).getByRole('button', { name: 'Переименовать' }));
    fireEvent.click(within(dayMenu).getByRole('button', { name: 'Закрыть меню' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Добавить упражнение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить заполнение фазы' }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(onStartWorkout).not.toHaveBeenCalled();
    noCalendarWrites();
  });

  it('passes the chosen client through the same full details page', async () => {
    const { onStartWorkout } = setup();
    const card = await openDetails(true);
    expect(state.list).toHaveBeenCalledWith('client');
    fireEvent.click(within(card).getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(onStartWorkout).toHaveBeenCalledWith({ athleteUserId: 'client', programId: 'program', dayId: 'day' }));
    noCalendarWrites();
  });

  it('delegates an empty programme scope to the root once without creating calendar data', async () => {
    state.list.mockResolvedValue([]);
    const { onStartWorkout, onCreated } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Моя тренировка' }));
    await waitFor(() => expect(onStartWorkout).toHaveBeenCalledExactlyOnceWith({ athleteUserId: 'coach' }));
    expect(onCreated).not.toHaveBeenCalled();
    noCalendarWrites();
  });

  it('blocks repeated starts until the root completes, then exposes failures for retry', async () => {
    let rejectStart: (error: Error) => void = () => {};
    const onStartWorkout = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStart = reject; }));
    setup(onStartWorkout);
    const card = await openDetails();
    const start = within(card).getByRole<HTMLButtonElement>('button', { name: 'Начать тренировку' });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(onStartWorkout).toHaveBeenCalledOnce();
    expect(start.disabled).toBe(true);
    rejectStart(new Error('Не удалось начать тренировку'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Не удалось начать тренировку');
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    expect(onStartWorkout).toHaveBeenCalledTimes(2);
    noCalendarWrites();
  });
});
