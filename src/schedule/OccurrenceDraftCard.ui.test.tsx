// @vitest-environment jsdom
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { SortableListProps } from '../ui/SortableList';
import { OccurrenceDraftCard, OccurrenceDraftSheet } from './OccurrenceDraftSheet';

const probes = vi.hoisted(() => ({
  exerciseMounts: 0,
  start: undefined as (() => void) | undefined,
  date: undefined as ((value: string) => void) | undefined,
  saveSet: undefined as (() => Promise<void>) | undefined,
  select: undefined as (() => void) | undefined,
  tracking: undefined as (() => Promise<string>) | undefined,
}));
vi.mock('konsta/react', async importOriginal => ({
  ...await importOriginal<typeof import('konsta/react')>(),
  Toast: ({ opened, children }: { opened?: boolean; children?: ReactNode }) => opened ? <div role="status">{children}</div> : null,
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ db: {}, actorUserId: 'tg:101' }) }));
vi.mock('../data/cloud/workout-planning', () => ({ WorkoutPlanningRepository: class {
  programs = { trackingTypeForExercise: () => probes.tracking?.() ?? Promise.resolve('weight_reps') };
} }));
vi.mock('./WorkoutPerson', () => ({ useWorkoutPerson: () => ({ name: 'Тренер', avatar: <span>Фото</span>, compactAvatar: null }) }));
vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('./WorkoutProgramSheet', () => ({ WorkoutProgramSheet: () => null }));
vi.mock('../program/ProgramExerciseInformationSheet', () => ({ ProgramExerciseInformationSheet: () => <div>Информация упражнения</div> }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: ({ onConfirm }: {
  onConfirm: (ids: string[]) => void;
}) => { probes.select = () => onConfirm(['new-exercise']); return null; } }));
vi.mock('../workout/SetEntry', () => ({ SetEntry: ({ onPlanSave, readOnly }: {
  onPlanSave: (input: { reps: number; setType: null }) => Promise<void>; readOnly?: boolean;
}) => {
  probes.saveSet = () => onPlanSave({ reps: 12, setType: null });
  return <div role="dialog" aria-label="Подход" data-readonly={readOnly} />;
} }));
vi.mock('../workout/SessionExercise', () => ({ SessionExercise: ({ onAddSet, onOpenSet, onInformation }: {
  onAddSet?: () => void; onOpenSet?: (id: string) => void; onInformation?: () => void;
}) => {
  probes.exerciseMounts += 1;
  return <div>
    <button onClick={onAddSet}>Добавить подход</button>
    <button onClick={() => onOpenSet?.('set')}>Открыть подход</button>
    <button onClick={onInformation}>Информация</button>
  </div>;
} }));
vi.mock('../ui', async importOriginal => ({
  ...await importOriginal<typeof import('../ui')>(),
  SortableList: ({ items, header, footer }: SortableListProps) => <div>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
  GlassSurface: ({ children, className, shape, preset, onClick, 'aria-disabled': disabled }: ButtonHTMLAttributes<HTMLButtonElement> & {
    shape?: string; preset?: string;
  }) => {
    if (className?.includes('start-workout-button')) probes.start = () => onClick?.({} as MouseEvent<HTMLButtonElement>);
    return shape === 'capsule' ? <button className={className} data-shape={shape} data-preset={preset}
      disabled={disabled === true || disabled === 'true'} onClick={onClick}>{children}</button>
      : <div data-testid="glass-card" data-preset={preset}>{children}</div>;
  },
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  MezfitBottomSheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MezfitDialog: ({ opened, children, buttons }: { opened: boolean; children: ReactNode; buttons: ReactNode }) => opened ? <div>{children}{buttons}</div> : null,
  MezfitDialogButton: ({ children, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) => <button onClick={onClick}>{children}</button>,
  DatePicker: ({ opened, onChange }: { opened: boolean; onChange: (value: string) => void }) => {
    probes.date = onChange;
    return opened ? <button onClick={() => onChange('2026-10-28')}>Выбрать дату</button> : null;
  },
  TimePicker: () => null,
}));

const plan: LocalWorkoutOccurrenceDraft['plan'] = { name: 'День А', comment: null, exercises: [{
  id: 'exercise', sourceProgramExerciseId: null, position: 0, notes: null,
  exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null, mediaUrl: null },
  sets: [{ id: 'set', sourceProgramSetId: null, position: 0, setLabel: null, setType: null,
    comment: null, materialLinks: [], chatLinks: [], plannedReps: 8, plannedWeightKg: 50,
    plannedDurationSeconds: null, plannedDistanceMeters: null }],
}] };
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:one', actorUserId: 'tg:101', realmId: 'relationship', trainingPlanId: 'program', programDayId: 'day',
  athleteUserId: 'tg:202', coachUserId: 'tg:101', clientUserId: 'tg:202', format: 'coached',
  startsAtUtc: '2026-10-27T08:00:00.000Z', durationMinutes: 60, plan, originalPlan: plan,
  createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z',
};
function setup() {
  const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
  vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
  vi.spyOn(drafts, 'pendingEditError').mockReturnValue('');
  vi.spyOn(drafts, 'get').mockResolvedValue(draft);
  vi.spyOn(drafts, 'enqueueEdit').mockResolvedValue(undefined);
  vi.spyOn(drafts, 'delete').mockResolvedValue(undefined);
  return { draft, drafts, sourceProgramName: 'Программа', onClose: vi.fn(), onSave: vi.fn(async () => undefined) };
}
afterEach(() => {
  cleanup();
  Object.assign(probes, { exerciseMounts: 0, start: undefined, date: undefined, saveSet: undefined, select: undefined, tracking: undefined });
});
const lockedMessage = 'Тренировка была запущена. Изменить план нельзя';

describe('shared scheduled occurrence UI', () => {
  it('keeps one header with timing, chevron before avatar, and lazily mounts expanded content', () => {
    const props = setup();
    const toggle = vi.fn();
    const { rerender } = render(<OccurrenceDraftCard {...props} collapsed onCollapsedChange={toggle} />);
    expect(screen.getAllByText('День А')).toHaveLength(1);
    expect(screen.getByText('27.10.2026')).toBeTruthy();
    expect(screen.getByText('08:00 – 09:00')).toBeTruthy();
    expect(probes.exerciseMounts).toBe(0);
    expect(screen.queryByText('План на тренировку')).toBeNull();
    const chevron = screen.getByRole('button', { name: 'Развернуть тренировку' });
    expect(chevron.nextElementSibling?.getAttribute('aria-label')).toBe('Атлет: Тренер');
    fireEvent.click(chevron);
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={toggle} />);
    expect(screen.getAllByText('День А')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Свернуть тренировку' }).getAttribute('aria-expanded')).toBe('true');
    expect(probes.exerciseMounts).toBeGreaterThan(0);
    expect(screen.getByText('План на тренировку')).toBeTruthy();
    const surface = screen.getByTestId('glass-card');
    expect(surface.getAttribute('data-preset')).toBe('modalTuned');
    expect(surface.contains(screen.getByText('День А'))).toBe(true);
    expect(surface.contains(screen.getByText('План на тренировку'))).toBe(true);
    expect(screen.queryByText('Запланированная тренировка')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    rerender(<OccurrenceDraftCard {...props} collapsed onCollapsedChange={toggle} />);
    expect(screen.queryByText('Добавить подход')).toBeNull();
    expect(screen.queryByText('Сохранить')).toBeNull();
  });

  it.each(['sheet', 'card'] as const)('%s flushes before Start, rejects same-tick repeats, and keeps errors editable', async surface => {
    const props = setup();
    const latest = { ...draft, durationMinutes: 90 };
    vi.mocked(props.drafts.get).mockResolvedValue(latest);
    let resolveFlush: (() => void) | undefined;
    vi.mocked(props.drafts.flushEdits).mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>(resolve => { resolveFlush = resolve; }));
    const onStart = vi.fn(async () => { throw new Error('Старт недоступен'); });
    render(surface === 'sheet' ? <OccurrenceDraftSheet {...props} onStart={onStart} />
      : <OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    const startButton = screen.getByRole('button', { name: 'Начать тренировку' });
    expect(startButton.getAttribute('data-shape')).toBe('capsule');
    expect(startButton.getAttribute('data-preset')).toBe('modalTuned');
    const staleClick = probes.start;
    act(() => { staleClick?.(); staleClick?.(); });
    await waitFor(() => expect(resolveFlush).toBeTypeOf('function'));
    expect(onStart).not.toHaveBeenCalled();
    await act(async () => { resolveFlush?.(); });
    await waitFor(() => expect(onStart).toHaveBeenCalledExactlyOnceWith(latest));
    expect(screen.getByRole('alert').textContent).toBe('Старт недоступен');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Начать тренировку' }).hasAttribute('disabled')).toBe(false);
  });

  it.each(['sheet', 'card'] as const)('%s uses the existing set edit queue and Save callback', async surface => {
    const props = setup();
    render(surface === 'sheet' ? <OccurrenceDraftSheet {...props} />
      : <OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    await waitFor(() => expect(props.drafts.enqueueEdit).toHaveBeenCalledOnce());
    const apply = vi.mocked(props.drafts.enqueueEdit).mock.calls[0][1];
    const changed = apply(draft);
    expect(changed.plan.exercises[0].sets).toHaveLength(2);
    expect(changed.plan.exercises[0].sets[1].plannedWeightKg).toBe(50);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledExactlyOnceWith(draft, false));
  });

  it('blocks Start on a failed edit flush', async () => {
    const props = setup();
    vi.mocked(props.drafts.flushEdits).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Правки не сохранены'));
    const onStart = vi.fn();
    render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Правки не сохранены'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it.each(['flush', 'read'] as const)('does not Start after unmount during the pending %s', async stage => {
    const props = setup();
    let finishFlush: (() => void) | undefined;
    let finishRead: ((value: LocalWorkoutOccurrenceDraft) => void) | undefined;
    if (stage === 'flush') {
      vi.mocked(props.drafts.flushEdits).mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => new Promise<void>(resolve => { finishFlush = resolve; }));
    } else {
      vi.mocked(props.drafts.get).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    }
    const onStart = vi.fn();
    const { unmount } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    const staleClick = probes.start;
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(stage === 'flush' ? finishFlush : finishRead).toBeTypeOf('function'));
    unmount();
    await act(async () => { finishFlush?.(); finishRead?.(draft); });
    const flushCalls = vi.mocked(props.drafts.flushEdits).mock.calls.length;
    act(() => { staleClick?.(); });
    expect(props.drafts.flushEdits).toHaveBeenCalledTimes(flushCalls);
    expect(onStart).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each(['flush', 'read'] as const)('rechecks read-only permission after the pending %s', async stage => {
    const props = setup();
    let finishFlush: (() => void) | undefined;
    let finishRead: ((value: LocalWorkoutOccurrenceDraft) => void) | undefined;
    if (stage === 'flush') {
      vi.mocked(props.drafts.flushEdits).mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => new Promise<void>(resolve => { finishFlush = resolve; }));
    } else {
      vi.mocked(props.drafts.get).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    }
    const onStart = vi.fn();
    const { rerender } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    const staleClick = probes.start;
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(stage === 'flush' ? finishFlush : finishRead).toBeTypeOf('function'));
    rerender(<OccurrenceDraftCard {...props} readOnly collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    await act(async () => { finishFlush?.(); finishRead?.(draft); });
    const flushCalls = vi.mocked(props.drafts.flushEdits).mock.calls.length;
    act(() => { staleClick?.(); });
    expect(props.drafts.flushEdits).toHaveBeenCalledTimes(flushCalls);
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Начать тренировку' }).hasAttribute('disabled')).toBe(true);
  });

  it('handles a Start failure after unmount without closing or affecting a replacement editor', async () => {
    const props = setup();
    let rejectStart: ((reason: Error) => void) | undefined;
    const onStart = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStart = reject; }));
    const { unmount } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(rejectStart).toBeTypeOf('function'));
    unmount();
    render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} onStart={onStart} />);
    await act(async () => { rejectStart?.(new Error('Поздняя ошибка')); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Начать тренировку' }).hasAttribute('disabled')).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it.each([false, true])('reports a locked set opening attempt with readOnly=%s', readOnly => {
    const props = setup();
    render(<OccurrenceDraftCard {...props} planLocked readOnly={readOnly} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход' }));
    expect(screen.getByRole('status').textContent).toBe(lockedMessage);
    expect(screen.queryByRole('dialog', { name: 'Подход' })).toBeNull();
  });

  it('rejects a set opening if the PLAN locks while its tracking type is loading', async () => {
    const props = setup();
    let finishTracking: ((value: string) => void) | undefined;
    probes.tracking = () => new Promise(resolve => { finishTracking = resolve; });
    const { rerender } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход' }));
    await waitFor(() => expect(finishTracking).toBeTypeOf('function'));
    rerender(<OccurrenceDraftCard {...props} planLocked collapsed={false} onCollapsedChange={vi.fn()} />);
    await act(async () => { finishTracking?.('weight_reps'); });
    expect(screen.getByRole('status').textContent).toBe(lockedMessage);
    expect(screen.queryByRole('dialog', { name: 'Подход' })).toBeNull();
  });

  it('blocks mutations from stale date, exercise picker, and SetEntry callbacks after owner locks the PLAN', async () => {
    const props = setup();
    const { rerender } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход' }));
    await screen.findByRole('dialog', { name: 'Подход' });
    const staleSave = probes.saveSet;
    const staleDate = probes.date;
    const staleSelect = probes.select;
    rerender(<OccurrenceDraftCard {...props} planLocked collapsed={false} onCollapsedChange={vi.fn()} />);
    act(() => { staleDate?.('2026-10-29'); staleSelect?.(); });
    await act(async () => { await expect(staleSave?.()).rejects.toThrow(lockedMessage); });
    expect(screen.getByRole('status').textContent).toBe(lockedMessage);
    expect(props.drafts.enqueueEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Подход' }).getAttribute('data-readonly')).toBe('true');
  });

  it('drops an edit still awaiting its local read when the owner locks the PLAN', async () => {
    const props = setup();
    let finishRead: ((value: LocalWorkoutOccurrenceDraft) => void) | undefined;
    vi.mocked(props.drafts.get).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const { rerender } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    await waitFor(() => expect(finishRead).toBeTypeOf('function'));
    rerender(<OccurrenceDraftCard {...props} planLocked collapsed={false} onCollapsedChange={vi.fn()} />);
    await act(async () => { finishRead?.(draft); });
    expect(props.drafts.enqueueEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(lockedMessage);
  });

  it('blocks a delete confirmation that was already open when the PLAN locks', () => {
    const props = setup();
    const { rerender } = render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить черновик' }));
    rerender(<OccurrenceDraftCard {...props} planLocked collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(props.drafts.delete).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(lockedMessage);
  });

  it('retains read-only permissions and owner-supplied frozen PLAN', () => {
    const props = setup();
    const frozen = { ...draft, plan: { ...plan, name: 'Зафиксированный план' } };
    render(<OccurrenceDraftCard {...props} draft={frozen} planLocked readOnly collapsed={false} onCollapsedChange={vi.fn()} />);
    expect(screen.getByText('Зафиксированный план')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить упражнение' })).toBeNull();
    expect(screen.getByRole('button', { name: /Дата:/ }).hasAttribute('disabled')).toBe(true);
    expect(props.drafts.enqueueEdit).not.toHaveBeenCalled();
  });
  it('shows the started-PLAN toast when the repository rejects a stale edit before lock props arrive', async () => {
    const props = setup();
    vi.mocked(props.drafts.enqueueEdit).mockRejectedValueOnce(new Error(lockedMessage));
    render(<OccurrenceDraftCard {...props} collapsed={false} onCollapsedChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    expect((await screen.findByRole('status')).textContent).toBe(lockedMessage);
  });

});
