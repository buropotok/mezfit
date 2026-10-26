// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramDayDialog } from './ProgramDayDialog';
import { ProgramPhaseDays } from './ProgramPhaseDays';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { WorkoutSessionCard } from '../workout/WorkoutSessionCard';

vi.mock('./ProgramSyncControls', () => ({ ProgramSyncControls: () => null }));

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const actions = vi.hoisted(() => ({ addDay: undefined as undefined | (() => void), disabled: false }));
vi.mock('../NavigationShell', () => ({
  useNavigationSurfaceFloatingAction: (action: { popoverItems?: { id: string; disabled?: boolean; onSelect?: () => void }[] } | null) => {
    const item = action?.popoverItems?.find((value) => value.id === 'add-day');
    actions.addDay = item?.onSelect;
    actions.disabled = item?.disabled ?? true;
  },
}));
vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  return { ...actual,
    SortableList: ({ items, header, footer, disabled, onReorder }: React.ComponentProps<typeof actual.SortableList>) =>
      <div>{header}<span data-testid="exercise-order">{items.map((item) => item.id).join(',')}</span>
        {items.map((item) => <div key={item.id}>{item.content}</div>)}
        {!disabled && items.length > 1
          ? <button onClick={() => onReorder([...items].reverse())}>Переставить упражнения</button> : null}
        {footer}</div>,
    LiquidPopover: ({ trigger, label, items = [], onPresentationChange }: React.ComponentProps<typeof actual.LiquidPopover>) =>
      <div>{trigger}<div role="menu" aria-label={label}>
        {items.map((item) => <button key={item.id} disabled={item.disabled} onClick={item.onSelect}>{item.label}</button>)}
        <button onClick={() => onPresentationChange?.(false)}>Закрыть меню</button>
      </div></div>,
  };
});
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); actions.addDay = undefined;
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

function fixture(phaseCount = 1) {
  const details: ProgramDetails = {
    program: { id: 'plan', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
      coachUserId: null, clientUserId: null, name: 'Программа', position: 0, status: 'draft',
      startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' },
    phases: Array.from({ length: phaseCount }, (_, position) => ({
      id: `phase-${position}`, realmId: 'tg:101', owner: 'tg:101', trainingPlanId: 'plan',
      name: `Фаза ${position + 1}`, position, status: 'draft', plannedStartDate: null, plannedEndDate: null,
    })), days: [],
  };
  const repo = {
    actorUserId: 'tg:101',
    observeDetails: (_id: string, next: (value: ProgramDetails) => void) => {
      next(details); return { unsubscribe: vi.fn() };
    },
    observeAthleteDetails: (_id: string, next: (value: ProgramDetails) => void) => {
      next(details); return { unsubscribe: vi.fn() };
    },
    createDay: vi.fn(async () => 'day'), editDay: vi.fn(async () => {}),
    commentDay: vi.fn(async () => {}), moveDay: vi.fn(async () => {}),
    duplicateDay: vi.fn(async () => 'copy'), deleteDay: vi.fn(async () => {}),
    deleteDayExercise: vi.fn(async () => {}),
    deleteExerciseSet: vi.fn(async () => {}),
    reorderDayExercises: vi.fn(async () => {}),
    exerciseInformation: vi.fn(async () => ({ row: null, taxonomy: [], name: 'Жим', mediaUrl: null })),
  };
  const page = (readOnly = false) => <CloudProgramDetailsPage
    repository={repo as unknown as ProgramManagementRepository} planId="plan" readOnly={readOnly}
    cloudStatus="ready" cloudError="" syncStatus="synced" syncError=""
    onRetryCloud={async () => {}} onRetrySync={async () => {}} />;
  return { details, repo, page };
}

const day: CloudProgramDayOutline = {
  day: { id: 'day-string-id', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase-0',
    name: 'День А', category: null, comment: 'Плавная техника', position: 0, status: 'active' },
  exercises: [],
};

describe('days inside program phases', () => {
  it('connects the exercise menu to confirmed deletion and exercise information', async () => {
    const f = fixture();
    f.details.days = [{ ...day, exercises: [{ exercise: {
      id: 'exercise', realmId: 'tg:101', owner: 'tg:101', programDayId: day.day.id,
      position: 0, status: 'active', notes: null,
      exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null, mediaUrl: null },
    }, sets: [] }] }];
    render(f.page());
    const menu = await screen.findByRole('menu', { name: 'Меню упражнения' });
    fireEvent.click(within(menu).getByRole('button', { name: 'Удалить' }));
    expect(f.repo.deleteDayExercise).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole('button', { name: 'Закрыть меню' }));
    const confirm = screen.getByRole('dialog', { name: 'Удалить упражнение?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(f.repo.deleteDayExercise).toHaveBeenCalledWith('plan', day.day.id, 'exercise'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Удалить упражнение?' })).toBeNull());
    fireEvent.click(within(menu).getByRole('button', { name: 'Информация' }));
    fireEvent.click(within(menu).getByRole('button', { name: 'Закрыть меню' }));
    const information = await screen.findByRole('dialog', { name: 'Информация об упражнении' });
    await within(information).findByText('Подробное описание пока недоступно на этом устройстве.');
    expect(f.repo.exerciseInformation).toHaveBeenCalledWith('plan', day.day.id, 'exercise');
  });
  it('skips phase selection for one phase, validates name on save without a category field', async () => {
    const { repo, page } = fixture();
    render(page());
    await screen.findByText('Фаза 1');
    act(() => actions.addDay?.());
    expect(screen.queryByRole('dialog', { name: 'Выберите фазу' })).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Добавить день' });
    expect(within(dialog).queryByRole('textbox', { name: 'Категория' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(within(dialog).getByText('Обязательно к заполнению')).toBeTruthy();
    expect(repo.createDay).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название' }), { target: { value: '  День А ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(repo.createDay).toHaveBeenCalledWith('plan', 'phase-0', 'День А', ''));
  });

  it('selects a phase when there are several and disables creation when there are none', async () => {
    const f = fixture(2);
    const view = render(f.page());
    await screen.findByText('Фаза 2');
    act(() => actions.addDay?.());
    const picker = screen.getByRole('dialog', { name: 'Выберите фазу' });
    fireEvent.click(within(picker).getByText('Фаза 2'));
    fireEvent.click(within(picker).getByRole('button', { name: 'Подтвердить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить день' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название' }), { target: { value: 'Б' } });
    expect(within(dialog).queryByRole('textbox', { name: 'Категория' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(f.repo.createDay).toHaveBeenCalledWith('plan', 'phase-1', 'Б', ''));
    view.unmount();
    const empty = fixture(0);
    render(empty.page());
    await screen.findByText('Фазы');
    expect(actions.disabled).toBe(true);
  });

  it('renders program names and edits the day title without category input', async () => {
    const f = fixture();
    f.details.days = [day];
    render(f.page());
    const card = await screen.findByRole('article', { name: 'День День А' });
    expect(within(card).getByText(f.details.program.name)).toBeTruthy();
    expect(within(card).queryByRole('progressbar')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Начать' }).hasAttribute('disabled')).toBe(true);
    expect(within(card).getByRole('button', { name: 'Добавить упражнение' }).hasAttribute('disabled')).toBe(false);
    const menu = within(card).getByRole('menu', { name: 'Меню дня День А' });
    expect(within(menu).getByRole('button', { name: 'Вверх' }).hasAttribute('disabled')).toBe(true);
    expect(within(menu).getByRole('button', { name: 'Вниз' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(menu).getByRole('button', { name: 'Переименовать' }));
    fireEvent.click(within(menu).getByRole('button', { name: 'Закрыть меню' }));
    const dialog = await screen.findByRole('dialog', { name: 'Изменить день' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название' }), { target: { value: 'Новый день' } });
    expect(within(dialog).queryByRole('textbox', { name: 'Категория' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(f.repo.editDay).toHaveBeenCalledWith('plan', 'day-string-id', 'Новый день', ''));
  });

  it('shows set deletion for the coach and confirms before mutating PLAN', async () => {
    const f = fixture();
    f.details.days = [{ ...day, exercises: [{
      exercise: { id: 'exercise', realmId: 'tg:101', owner: 'tg:101', programDayId: day.day.id,
        position: 0, status: 'active', notes: null,
        exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null, mediaUrl: null } },
      sets: [{ id: 'set', realmId: 'tg:101', owner: 'tg:101', programExerciseId: 'exercise',
        position: 0, status: 'active', setType: null, comment: null,
        plannedWeightKg: null, plannedReps: null, plannedDurationSeconds: null, plannedDistanceMeters: null }],
    }] }];
    render(f.page());
    fireEvent.click(await screen.findByRole('button', { name: 'Развернуть упражнение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход 1' }));
    expect(f.repo.deleteExerciseSet).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Удалить подход?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(f.repo.deleteExerciseSet).toHaveBeenCalledWith('plan', day.day.id, 'exercise', 'set'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Удалить подход?' })).toBeNull());
  });

  it('keeps an optimistic exercise order until Dexie confirms and rolls back on failure', async () => {
    const f = fixture();
    const exercise = (id: string, position: number) => ({
      exercise: { id, realmId: 'tg:101', owner: 'tg:101', programDayId: day.day.id, position,
        status: 'active' as const, notes: null,
        exercise: { exerciseDefinitionId: id, scope: 'public' as const, name: id, nameEn: null, mediaUrl: null } },
      sets: [],
    });
    const source = { ...day, exercises: [exercise('first', 0), exercise('second', 1)] };
    const page = (value: CloudProgramDayOutline) => <ProgramPhaseDays
      repository={f.repo as unknown as ProgramManagementRepository}
      program={f.details.program} days={[value]} readOnly={false} />;
    const view = render(page(source));
    expect(screen.getByTestId('exercise-order').textContent).toBe('first,second');
    let rejectWrite: (reason: Error) => void = () => {};
    f.repo.reorderDayExercises.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Переставить упражнения' }));
    expect(screen.getByTestId('exercise-order').textContent).toBe('second,first');
    expect(f.repo.reorderDayExercises).toHaveBeenCalledWith('plan', day.day.id, ['second', 'first']);
    await act(async () => rejectWrite(new Error('Запись недоступна')));
    await waitFor(() => expect(screen.getByTestId('exercise-order').textContent).toBe('first,second'));
    expect(screen.getByRole('alert').textContent).toBe('Запись недоступна');
    f.repo.reorderDayExercises.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Переставить упражнения' }));
    expect(screen.getByTestId('exercise-order').textContent).toBe('second,first');
    await waitFor(() => expect(f.repo.reorderDayExercises).toHaveBeenCalledTimes(2));
    view.rerender(page({ ...source, exercises: [...source.exercises].reverse().map((item, position) => ({
      ...item, exercise: { ...item.exercise, position },
    })) }));
    await waitFor(() => expect(screen.getByTestId('exercise-order').textContent).toBe('second,first'));
  });

  it('drops an optimistic preview when a concurrent authoritative exercise order arrives', async () => {
    const f = fixture();
    const entry = (id: string, position: number) => ({
      exercise: { id, realmId: 'tg:101', owner: 'tg:101', programDayId: day.day.id, position,
        status: 'active' as const, notes: null,
        exercise: { exerciseDefinitionId: id, scope: 'public' as const, name: id, nameEn: null, mediaUrl: null } },
      sets: [],
    });
    const original = { ...day, exercises: [entry('first', 0), entry('second', 1), entry('third', 2)] };
    f.repo.reorderDayExercises.mockImplementation(() => new Promise<void>(() => {}));
    const page = (value: CloudProgramDayOutline) => <ProgramPhaseDays
      repository={f.repo as unknown as ProgramManagementRepository}
      program={f.details.program} days={[value]} readOnly={false} />;
    const view = render(page(original));
    fireEvent.click(screen.getByRole('button', { name: 'Переставить упражнения' }));
    expect(screen.getByTestId('exercise-order').textContent).toBe('third,second,first');
    const concurrent = [original.exercises[1], original.exercises[0], original.exercises[2]]
      .map((item, position) => ({ ...item, exercise: { ...item.exercise, position } }));
    view.rerender(page({ ...original, exercises: concurrent }));
    await waitFor(() => expect(screen.getByTestId('exercise-order').textContent).toBe('second,first,third'));
  });

  it('keeps assigned cards read-only and omits all authoring controls', async () => {
    const f = fixture();
    f.details.days = [day];
    render(f.page(true));
    const card = await screen.findByRole('article', { name: 'День День А' });
    expect(within(card).getByText('Плавная техника')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('retains the draft on failure and prevents double submission while saving', async () => {
    let rejectSave: (reason: Error) => void = () => {};
    const save = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const close = vi.fn();
    render(<ProgramDayDialog title="Добавить день" onSave={save} onClose={close} />);
    const dialog = screen.getByRole('dialog', { name: 'Добавить день' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название' }), { target: { value: 'Черновик' } });
    const button = within(dialog).getByRole('button', { name: 'Сохранить' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { rejectSave(new Error('Нет места на устройстве')); });
    expect(within(dialog).getByRole('alert').textContent).toBe('Нет места на устройстве');
    expect((within(dialog).getByRole('textbox', { name: 'Название' }) as HTMLInputElement).value).toBe('Черновик');
    expect(close).not.toHaveBeenCalled();
  });

  it('animates a persisted day reorder and cleans up on unmount', () => {
    const f = fixture();
    const second: CloudProgramDayOutline = { day: { ...day.day, id: 'second', name: 'Б', position: 1 }, exercises: [] };
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    const offsets = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement?.classList.contains('cloud-plan-days')
        ? Array.from(this.parentElement.children).indexOf(this) * 100 : 0;
    });
    const page = (items: CloudProgramDayOutline[]) => <ProgramPhaseDays
      repository={f.repo as unknown as ProgramManagementRepository} program={f.details.program} days={items} readOnly={false} />;
    const view = render(page([day, second]));
    view.rerender(page([second, day]));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('article').map((item) => item.getAttribute('aria-label'))).toEqual(['День Б', 'День День А']);
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
    offsets.mockRestore();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  it('shows the weight/reps PLAN and technique on a read-only program without FACT controls', () => {
    render(<WorkoutSessionCard mode="planning" day={{ ...day, exercises: [{
      exercise: { id: 'exercise', realmId: 'tg:101', owner: 'tg:101', programDayId: day.day.id,
        position: 0, status: 'active', notes: null, exercise: { exerciseDefinitionId: 'catalogue-id',
          scope: 'public', name: 'Жим', nameEn: null, trackingType: 'weight_reps', mediaUrl: null } },
      sets: [{ id: 'set', realmId: 'tg:101', owner: 'tg:101', programExerciseId: 'exercise', position: 0,
        status: 'active', setType: 'dropset', comment: 'Контроль техники',
        plannedWeightKg: 123, plannedReps: 15, plannedDurationSeconds: null, plannedDistanceMeters: null }],
    }] }} creatorName="Тренер" readOnly onEdit={() => {}} onComment={() => {}}
      onMove={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    // Preserve lazy rendering while the exercise is collapsed.
    expect(screen.queryByText('Тип подхода: Дропсет')).toBeNull();
    expect(screen.queryByText('Подход 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть упражнение' }));
    expect(screen.getByText('Подход 1')).toBeTruthy();
    expect(screen.queryByText(/123 кг|15 повт\.|ввести план/)).toBeNull();
    expect(screen.getByText('Тип подхода: Дропсет')).toBeTruthy();
    expect(screen.getByText('Контроль техники')).toBeTruthy();
    // A program PLAN must not expose an execution result or an editor in read-only mode.
    expect(screen.queryByText(/Пред\.:|ввести факт|выполнено|RPE/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить подход 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Открыть подход 1' })).toBeNull();
  });
});
