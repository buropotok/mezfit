// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode, TransitionEventHandler } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import type { CloudProgramDayOutline } from '../data/cloud/workout-foundation-types';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutSlotConflict } from '../data/cloud/workout-slot-validation';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';

vi.mock('../workout/StartWorkoutButton', () => ({
  StartWorkoutButton: ({ disabled, onClick }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button disabled={disabled} onClick={onClick}>Начать тренировку</button>,
}));

const cloudEnabled = vi.hoisted(() => ({ value: false }));
const overlayProbe = vi.hoisted(() => ({ animated: false, zeroDuration: false, dates: 0, times: 0, dialogs: 0, selectors: 0 }));

vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => cloudEnabled.value
  ? { db: { publicExerciseDefinitions: { get: async () => ({ tracking_type: 'weight_reps' }) } },
      actorUserId: 'tg:101' } : null }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => {
  overlayProbe.selectors += 1;
  return null;
} }));
vi.mock('../workout/WorkoutPlanCard', () => ({
  WorkoutPlanCard: ({ onAddSet, onOpenSet, onExerciseInformation, programName, hideProgramName, day }: {
    onAddSet?: (id: string) => void; onOpenSet?: (exerciseId: string, setId: string) => void;
    onExerciseInformation?: (id: string) => void;
    programName?: string; hideProgramName?: boolean; day?: CloudProgramDayOutline;
  }) => <>
    <span data-testid="scheduled-program-name">{hideProgramName ? null : programName}</span>
    <span data-testid="scheduled-set-techniques">{day?.exercises.flatMap(exercise =>
      exercise.sets.map(set => set.setType ?? 'ordinary')).join(',') ?? ''}</span>
    <button onClick={() => onAddSet?.('exercise')}>Добавить подход</button>
    {day?.exercises.flatMap(exercise => exercise.sets.map(set =>
      <button key={set.id} onClick={() => onOpenSet?.(exercise.exercise.id, set.id)}>
        Открыть план подхода {set.position + 1}
      </button>))}
    {onExerciseInformation ? <button onClick={() => onExerciseInformation('exercise')}>
      Информация упражнения
    </button> : null}
  </>,
}));
vi.mock('../workout/SetEntry', () => ({
  SetEntry: ({ data, onPlanSave, onClose, onDeleteSet, readOnly }: {
    readOnly?: boolean;
    data: { plan: { weightKg: number | null; reps: number | null } };
    onPlanSave: (metrics: { weightKg: number; reps: number; setType: 'cluster' }) => Promise<void>;
    onClose: () => void; onDeleteSet?: () => Promise<void>;
  }) => <div role="dialog" aria-label="План конкретной тренировки" data-read-only={readOnly}>
    <span data-testid="occurrence-plan-weight">{data.plan.weightKg ?? '—'}</span>
    <button disabled={readOnly} onClick={() => { void onPlanSave({ weightKg: 80.75, reps: 8, setType: 'cluster' }); }}>
      Сохранить план подхода
    </button>
    <button onClick={() => { void onDeleteSet?.(); }}>Удалить план подхода</button>
    <button onClick={onClose}>Закрыть план</button>
  </div>,
}));

vi.mock('../program/ProgramExerciseInformationSheet', () => ({
  ProgramExerciseInformationSheet: ({ snapshot, onClose }: {
    snapshot?: { exerciseDefinitionId: string }; onClose: () => void;
  }) => <div role="dialog" aria-label="Информация об упражнении">
    <span>Снимок: {snapshot?.exerciseDefinitionId}</span>
    <button onClick={onClose}>Закрыть информацию</button>
  </div>,
}));
vi.mock('../ui', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Avatar: ({ name, size }: { name: string; size?: 'default' | 'small' }) =>
    <span role="img" aria-label={name} data-size={size} />,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  Button: ({ children, onClick, disabled, size }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'default' | 'compact' }) =>
    <button onClick={onClick} disabled={disabled} data-size={size}>{children}</button>,
  IconButton: ({ label, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) =>
    <button aria-label={label} onClick={onClick} disabled={disabled} />, Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />, TimePicker: ({ opened, value, onChange, onClose }: {
    opened: boolean; value: string; onChange: (time: string) => void; onClose: () => void;
  }) => {
    overlayProbe.times += 1;
    return opened ? <div role="dialog" aria-label="Выбор времени">
      <output data-testid="time-picker-value">{value}</output>
      <button onClick={() => onChange('09:30')}>Выбрать 09:30</button>
      <button onClick={() => onChange('10:45')}>Выбрать 10:45</button>
      <button onClick={onClose}>Скрыть выбор времени</button>
    </div> : null;
  },
  DatePicker: ({ opened, onChange }: { opened: boolean; onChange: (date: string) => void }) => {
    overlayProbe.dates += 1;
    return opened ? <div>
      <button onClick={() => onChange('2026-10-20')}>Занятая дата</button>
      <button onClick={() => onChange('invalid')}>Некорректная дата</button>
      <button onClick={() => onChange('2026-10-21')}>Свободная дата</button>
    </div> : null;
  },
  Text: ({ children, role }: { children: ReactNode; role?: string }) => <span role={role}>{children}</span>,
  MezfitBottomSheet: ({ children, opened, id, onTransitionEnd }: { children: ReactNode; opened: boolean;
    id?: string; onTransitionEnd?: TransitionEventHandler<HTMLDivElement> }) =>
    <div id={id} data-testid="sheet-shell" data-open={opened}
      style={overlayProbe.animated ? { transitionProperty: 'transform',
        transitionDuration: overlayProbe.zeroDuration ? '0ms' : '400ms', transitionDelay: '0ms' } : undefined}
      onTransitionEnd={onTransitionEnd}>{children}</div>,
  MezfitDialog: ({ opened, title, children, buttons }: { opened: boolean; title?: ReactNode; children?: ReactNode; buttons: ReactNode }) => {
    overlayProbe.dialogs += 1;
    return opened ? <div>{title}{children}{buttons}</div> : null;
  },
  MezfitDialogButton: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
afterEach(() => {
  cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); cloudEnabled.value = false;
  Object.assign(overlayProbe, { animated: false, zeroDuration: false, dates: 0, times: 0, dialogs: 0, selectors: 0 });
});
const plan = { name: 'День', comment: null, exercises: [{
  id: 'exercise', sourceProgramExerciseId: null, position: 0, notes: null, sets: [],
  exercise: { exerciseDefinitionId: '0001', scope: 'public' as const, name: 'Жим', nameEn: null, mediaUrl: null },
}] };
const draft: LocalWorkoutOccurrenceDraft = {
  id: 'draft:one', actorUserId: 'tg:101', realmId: 'tg:101', trainingPlanId: 'program',
  programDayId: 'day', athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  format: 'independent', startsAtUtc: '2026-10-19T08:00:00.000Z', durationMinutes: 60,
  plan, originalPlan: plan, createdAt: '2026-10-18T08:00:00.000Z', updatedAt: '2026-10-18T08:00:00.000Z',
};

describe('calendar plan technique projection', () => {
  it.each([false, true])('keeps lifecycle actions in the scrolling body and hides them on drafts (saved=%s)', saved => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={{ ...draft, saved }} drafts={drafts} onClose={vi.fn()}
      onSave={vi.fn()} onStart={vi.fn()} onCancel={vi.fn()} onDelete={vi.fn()} />);
    const remove = screen.getByRole('button', { name: 'Удалить' });
    expect(remove.closest('.occurrence-draft-sheet__body')).not.toBeNull();
    if (saved) {
      expect(screen.getByRole('button', { name: 'Начать тренировку' }).closest('.occurrence-draft-sheet__body')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Отменить тренировку' }).closest('.occurrence-draft-sheet__body')).not.toBeNull();
    } else {
      expect(screen.queryByRole('button', { name: 'Начать тренировку' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Отменить тренировку' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Сохранить' }).closest('.occurrence-draft-sheet__body')).not.toBeNull();
    }
  });
  it('delivers the specialized set technique from the scheduled plan to its rendered card', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const plannedSet = {
      id: 'set-one', sourceProgramSetId: 'source-set-one', position: 0,
      setType: 'dropset' as const, setLabel: null, comment: null,
      materialLinks: [], chatLinks: [], plannedReps: 8, plannedWeightKg: 80,
      plannedDurationSeconds: null, plannedDistanceMeters: null,
    };
    const plannedDraft: LocalWorkoutOccurrenceDraft = { ...draft,
      plan: { ...plan, exercises: [{ ...plan.exercises[0], sets: [plannedSet] }] },
    };
    render(<OccurrenceDraftSheet draft={plannedDraft} drafts={drafts}
      onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    expect(screen.getByTestId('scheduled-set-techniques').textContent).toBe('dropset');
  });
});

describe('adding sets to a scheduled PLAN', () => {
  it('persists a copy of the previous set through the existing local-first edit flow', async () => {
    const previous = {
      id: 'set-one', sourceProgramSetId: 'template-set-one', position: 0,
      setType: 'cluster' as const, setLabel: null, comment: 'Контроль техники',
      materialLinks: ['material:1'], chatLinks: [],
      plannedReps: 19, plannedWeightKg: 57,
      plannedDurationSeconds: null, plannedDistanceMeters: null,
    };
    const scheduled: LocalWorkoutOccurrenceDraft = {
      ...draft, plan: { ...plan, exercises: [{ ...plan.exercises[0], sets: [previous] }] },
    };
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(scheduled);
    const persisted: { current: LocalWorkoutOccurrenceDraft | null } = { current: null };
    const enqueue = vi.spyOn(drafts, 'enqueueEdit').mockImplementation(async (_id, change) => {
      persisted.current = change(structuredClone(scheduled));
    });

    render(<OccurrenceDraftSheet draft={scheduled} drafts={drafts}
      onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить подход' }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledOnce());

    const [source, copy] = persisted.current!.plan.exercises[0].sets;
    expect(copy).toMatchObject({
      sourceProgramSetId: null, position: 1,
      plannedWeightKg: 57, plannedReps: 19,
      setType: 'cluster', comment: 'Контроль техники', materialLinks: ['material:1'],
    });
    expect(copy.id).not.toBe(source.id);
    expect(scheduled.plan.exercises[0].sets).toHaveLength(1);
    expect(scheduled.originalPlan).toBe(draft.originalPlan);
  });
});

describe('editing PLAN in one scheduled occurrence', () => {
  it('writes weight, repetitions and technique only to this occurrence and not its template', async () => {
    cloudEnabled.value = true;
    const set = {
      id: 'set-1', sourceProgramSetId: 'template-set-1', position: 0,
      setType: null, setLabel: null, comment: null,
      materialLinks: [], chatLinks: [], plannedWeightKg: null, plannedReps: null,
      plannedDurationSeconds: null, plannedDistanceMeters: null,
    };
    const scheduled: LocalWorkoutOccurrenceDraft = { ...draft,
      plan: { ...plan, exercises: [{ ...plan.exercises[0], sets: [set] }] },
    };
    const untouchedOccurrence = structuredClone(scheduled.plan);
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(scheduled);
    const persisted: { current: LocalWorkoutOccurrenceDraft | null } = { current: null };
    const enqueue = vi.spyOn(drafts, 'enqueueEdit').mockImplementation(async (_id, apply) => {
      persisted.current = apply(structuredClone(scheduled));
    });

    render(<OccurrenceDraftSheet draft={scheduled} drafts={drafts}
      sourceProgramName="Сила" onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть план подхода 1' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'План конкретной тренировки' })).toBeTruthy());
    expect(screen.getByTestId('occurrence-plan-weight').textContent).toBe('—');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить план подхода' }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    expect(persisted.current!.plan.exercises[0].sets[0]).toEqual(expect.objectContaining({
      plannedWeightKg: 80.75, plannedReps: 8, setType: 'cluster',
      sourceProgramSetId: 'template-set-1',
    }));
    expect(scheduled.plan).toEqual(untouchedOccurrence);
    expect(scheduled.plan.exercises[0].sets[0].plannedWeightKg).toBeNull();
  });

  it('does not open a PLAN editor for read-only scheduled workouts', () => {
    cloudEnabled.value = true;
    const set = {
      id: 'set-1', sourceProgramSetId: 'template-set-1', position: 0,
      setType: null, setLabel: null, comment: null, materialLinks: [], chatLinks: [],
      plannedWeightKg: null, plannedReps: null, plannedDurationSeconds: null, plannedDistanceMeters: null,
    };
    const scheduled = { ...draft, plan: { ...plan, exercises: [{ ...plan.exercises[0], sets: [set] }] } };
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={scheduled} drafts={drafts} readOnly onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть план подхода 1' }));
    expect(screen.queryByRole('dialog', { name: 'План конкретной тренировки' })).toBeNull();
  });
});

describe('deferred editor auxiliaries', () => {
  it('renders the real form during slide but mounts closed pickers and dialogs only after opening', async () => {
    overlayProbe.animated = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);

    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText('План на тренировку')).toBeTruthy();
    expect([overlayProbe.dates, overlayProbe.times, overlayProbe.dialogs, overlayProbe.selectors]).toEqual([0, 0, 0, 0]);

    fireEvent.transitionEnd(screen.getByTestId('sheet-shell'), { propertyName: 'transform' });
    await waitFor(() => {
      expect(overlayProbe.dates).toBeGreaterThan(0);
      expect(overlayProbe.times).toBeGreaterThan(0);
      expect(overlayProbe.dialogs).toBeGreaterThan(0);
      expect(overlayProbe.selectors).toBeGreaterThan(0);
    });
  });

  it('ignores a closing transition and defers helpers again on a new opening', async () => {
    overlayProbe.animated = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const props = { drafts, onClose: vi.fn(), onSave: vi.fn() };
    const view = render(<OccurrenceDraftSheet {...props} draft={draft} />);
    const shell = screen.getByTestId('sheet-shell');

    view.rerender(<OccurrenceDraftSheet {...props} draft={null} />);
    fireEvent.transitionEnd(shell, { propertyName: 'transform' });
    expect(overlayProbe.dates).toBe(0);

    view.rerender(<OccurrenceDraftSheet {...props} draft={draft} />);
    expect(overlayProbe.dates).toBe(0);
    fireEvent.transitionEnd(shell, { propertyName: 'transform' });
    await waitFor(() => expect(overlayProbe.dates).toBeGreaterThan(0));
  });

  it('falls back to the computed transition duration if WebView drops transitionend', async () => {
    overlayProbe.animated = true;
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);

    try {
      render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
      expect(overlayProbe.dates).toBe(0);
      await act(async () => { vi.runAllTimers(); });
      expect(overlayProbe.dates).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mounts helpers immediately when transitions are disabled', () => {
    overlayProbe.animated = true;
    overlayProbe.zeroDuration = true;
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);

    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    expect(overlayProbe.dates).toBeGreaterThan(0);
    expect(overlayProbe.dialogs).toBeGreaterThan(0);
  });
});

describe('time selection while local edits are queued', () => {
  it.each([
    { button: /^Начало:/, initial: '08:00' },
    { button: /^Конец:/, initial: '09:00' },
  ])('keeps $initial wheel responsive before the persisted draft updates', ({ button, initial }) => {
    vi.stubEnv('TZ', 'UTC');
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(draft);
    vi.spyOn(drafts, 'enqueueEdit').mockImplementation(() => new Promise<void>(() => {}));

    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(screen.getByTestId('time-picker-value').textContent).toBe(initial);

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать 09:30' }));
    expect(screen.getByTestId('time-picker-value').textContent).toBe('09:30');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать 10:45' }));
    expect(screen.getByTestId('time-picker-value').textContent).toBe('10:45');
  });
});

describe('committing the final time on picker dismissal', () => {
  it.each([
    { button: /^Начало:/, changedField: 'startsAtUtc' },
    { button: /^Конец:/, changedField: 'durationMinutes' },
  ] as const)('writes $changedField only after closing, once per selection session', async ({ button, changedField }) => {
    vi.stubEnv('TZ', 'UTC');
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(draft);
    const write = vi.spyOn(drafts, 'enqueueEdit').mockResolvedValue(undefined);

    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: button }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать 09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать 10:45' }));
    expect(screen.getByTestId('time-picker-value').textContent).toBe('10:45');
    expect(screen.getByRole('button', { name: button }).textContent).toMatch(changedField === 'startsAtUtc' ? /08:00/ : /09:00/);
    expect(write).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть выбор времени' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const updated = write.mock.calls[0][1](structuredClone(draft));
    if (changedField === 'startsAtUtc') expect(updated.startsAtUtc).toBe('2026-10-19T10:45:00.000Z');
    else expect(updated.durationMinutes).toBe(165);
  });

  it('does not persist a value when the picker closes without a change', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const write = vi.spyOn(drafts, 'enqueueEdit').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Начало:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть выбор времени' }));
    expect(write).not.toHaveBeenCalled();
  });
});

describe('scheduled workout summary layout', () => {
  it('keeps start and end in one row beneath the date', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);

    const date = screen.getByRole('button', { name: /^Дата:/ });
    const start = screen.getByRole('button', { name: /^Начало:/ });
    const end = screen.getByRole('button', { name: /^Конец:/ });
    // All three labels share the compact Button's leading inset, so the feature container
    // can align their contents with the sheet title and sync status.
    expect([date, start, end].map(button => button.getAttribute('data-size'))).toEqual(['compact', 'compact', 'compact']);
    const timeRow = start.closest('.occurrence-draft-sheet__time-row');
    expect(timeRow).toBeTruthy();
    expect(timeRow).toBe(end.closest('.occurrence-draft-sheet__time-row'));
    expect(timeRow?.previousElementSibling).toBe(date);
  });

  it('shows the coach avatar beside users only for coached workouts with a coach', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const props = { drafts, onClose: vi.fn(), onSave: vi.fn() };
    const coached = { ...draft, format: 'coached' as const, coachUserId: 'tg:202' };
    const view = render(<OccurrenceDraftSheet draft={coached} {...props} />);
    const format = screen.getByText('С тренером в зале').parentElement;
    expect(format?.querySelector('[data-testid="icon-users"]')?.nextElementSibling?.className)
      .toBe('occurrence-draft-sheet__coach-avatar');
    expect(format?.querySelector('.occurrence-draft-sheet__coach-avatar [role="img"]')?.getAttribute('data-size'))
      .toBe('small');

    view.rerender(<OccurrenceDraftSheet draft={{ ...coached, coachUserId: null }} {...props} />);
    expect(screen.queryByText('С тренером в зале')?.parentElement?.querySelector('.occurrence-draft-sheet__coach-avatar'))
      .toBeNull();
    view.rerender(<OccurrenceDraftSheet draft={{ ...coached, format: 'independent' }} {...props} />);
    expect(screen.getByText('Самостоятельная').parentElement?.querySelector('.occurrence-draft-sheet__coach-avatar'))
      .toBeNull();
  });
});

describe('source program subtitle', () => {
  it('shows the supplied program name, never a duplicate of the day title', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const props = { drafts, onClose: vi.fn(), onSave: vi.fn() };
    const dayDraft = { ...draft, plan: { ...plan, name: 'День 1' } };
    const view = render(<OccurrenceDraftSheet draft={dayDraft} sourceProgramName="Силовая программа" {...props} />);
    expect(screen.getByTestId('scheduled-program-name').textContent).toBe('Силовая программа');

    view.rerender(<OccurrenceDraftSheet draft={dayDraft} sourceProgramName={null} {...props} />);
    expect(screen.getByTestId('scheduled-program-name').textContent).toBe('');
    view.rerender(<OccurrenceDraftSheet draft={dayDraft} sourceProgramName="Новая программа" {...props} />);
    expect(screen.getByTestId('scheduled-program-name').textContent).toBe('Новая программа');
  });
});

describe('draft edit recovery', () => {
  it('opens the shared information sheet from an occurrence snapshot even for read-only planning', async () => {
    cloudEnabled.value = true;
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} readOnly onClose={() => {}} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Информация упражнения' }));
    expect(await screen.findByText('Снимок: 0001')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть информацию' }));
    expect(screen.queryByText('Снимок: 0001')).toBeNull();
  });
  it('keeps one closed shell mounted before opening and across workout changes', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const props = { drafts, onClose: vi.fn(), onSave: vi.fn() };
    const view = render(<OccurrenceDraftSheet {...props} draft={null} />);
    const shell = screen.getByTestId('sheet-shell');
    expect(shell.getAttribute('data-open')).toBe('false');
    view.rerender(<OccurrenceDraftSheet {...props} draft={draft} />);
    expect(screen.getByTestId('sheet-shell')).toBe(shell);
    expect(shell.getAttribute('data-open')).toBe('true');
    view.rerender(<OccurrenceDraftSheet {...props} draft={{ ...draft, id: 'another' }} />);
    expect(screen.getByTestId('sheet-shell')).toBe(shell);
  });
  it.each(['independent', 'coached'] as const)('shows %s format and publication status independently from Save', format => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const view = render(<OccurrenceDraftSheet draft={{ ...draft, format }} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText('Запланированная тренировка')).toBeTruthy();
    expect(screen.getByText(format === 'coached' ? 'С тренером в зале' : 'Самостоятельная')).toBeTruthy();
    expect(screen.getByText('Черновик')).toBeTruthy();
    expect(screen.getByText('План на тренировку')).toBeTruthy();
    const label = screen.getByText(format === 'coached' ? 'С тренером в зале' : 'Самостоятельная');
    expect(label.nextElementSibling?.getAttribute('data-testid')).toBe(format === 'coached' ? 'icon-users' : 'icon-user');
    view.rerender(<OccurrenceDraftSheet draft={{ ...draft, format, saved: true }} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText('Запланировано')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });
  it.each(['Занятая дата', 'Некорректная дата'])('retains rejection of %s until timing is corrected, including across content edits', async badChoice => {
    vi.stubEnv('TZ', 'UTC');
    let current = structuredClone(draft);
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'get').mockImplementation(async () => structuredClone(current));
    vi.spyOn(drafts, 'edit').mockImplementation(async (_id, apply) => {
      const changed = apply(structuredClone(current));
      if (changed.startsAtUtc.startsWith('2026-10-20')) throw new WorkoutSlotConflict('Время занято');
      current = changed;
    });
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: /^Дата:/ }));
    expect(screen.getByRole('button', { name: 'Занятая дата' }).closest('[data-testid="sheet-shell"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: badChoice }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(false));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Добавить подход'));
    await waitFor(() => expect(current.plan.exercises[0].sets).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(false));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Свободная дата' }));
    await waitFor(() => expect(current.startsAtUtc).toBe('2026-10-21T08:00:00.000Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ startsAtUtc: '2026-10-21T08:00:00.000Z' }), false));
  });

  it('allows closing while a local Save is pending', async () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(draft);
    const close = vi.fn();
    const save = vi.fn(() => new Promise<void>(() => {}));
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={close} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('displays the parent-owned program result inside the open saved editor', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={{ ...draft, saved: true }} drafts={drafts} onClose={() => {}} onSave={vi.fn()}
      saveNotice="Тренировка сохранена. Программа не обновлена: День изменился" />);
    expect(screen.getByRole('alert').textContent).toContain('Программа не обновлена');
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  });

  it('shows Save only for a draft, while saved content remains editable', () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const view = render(<OccurrenceDraftSheet draft={{ ...draft, saved: true }} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.queryByText('Проверить сохранение')).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить подход' })).toBeTruthy();
    view.rerender(<OccurrenceDraftSheet draft={{ ...draft, saved: false }} drafts={drafts} onClose={() => {}} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy();
  });

  it('reports a write which failed after navigating away when the editor is reopened', async () => {
    let rejectWrite: (reason: Error) => void = () => {};
    const pending = new Promise<void>((_, reject) => { rejectWrite = reject; });
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    const edit = vi.spyOn(drafts, 'edit').mockImplementationOnce(() => pending)
      .mockRejectedValue(new Error('Нет места'));
    vi.spyOn(drafts, 'get').mockResolvedValue(draft);
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { rejectWrite(new Error('Нет места')); });
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Нет места');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(3));
    expect(save).not.toHaveBeenCalled();
  });

  it('retries the failed intent and blocks confirmation until it is persisted', async () => {
    const edit = vi.fn().mockRejectedValue(new Error('Недостаточно места'));
    const get = vi.fn().mockResolvedValue(draft);
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'edit').mockImplementation(edit);
    vi.spyOn(drafts, 'get').mockImplementation(get);
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Недостаточно места');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(2));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(false));
    edit.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(draft, false));
    expect(edit.mock.calls[2][1]).toBe(edit.mock.calls[0][1]);
  });

  it('waits for the latest queued edit before reading and confirming the draft', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const get = vi.fn().mockResolvedValue(draft);
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'edit').mockImplementation(() => pending);
    vi.spyOn(drafts, 'get').mockImplementation(get);
    const save = vi.fn().mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={draft} drafts={drafts} onClose={() => {}} onSave={save} />);
    fireEvent.click(screen.getByText('Добавить подход'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    finish();
    await waitFor(() => expect(save).toHaveBeenCalledWith(draft, false));
  });
});

describe('client access to assigned calendar PLAN', () => {
  it.each([false, true])('opens the coach set for inspection with parent readOnly=%s and never writes PLAN', async readOnly => {
    cloudEnabled.value = true;
    const scheduled: LocalWorkoutOccurrenceDraft = { ...draft, coachUserId: 'tg:202',
      clientUserId: 'tg:101', saved: true,
      plan: { ...plan, exercises: [{ ...plan.exercises[0], sets: [{
        id: 'assigned-set', sourceProgramSetId: null, position: 0, setType: 'cluster',
        setLabel: null, comment: null, materialLinks: [], chatLinks: [],
        plannedWeightKg: 70.75, plannedReps: 8, plannedDurationSeconds: null, plannedDistanceMeters: null,
      }] }] },
    };
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    const enqueue = vi.spyOn(drafts, 'enqueueEdit').mockResolvedValue(undefined);
    render(<OccurrenceDraftSheet draft={scheduled} drafts={drafts} readOnly={readOnly}
      onClose={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть план подхода 1' }));
    const editor = await screen.findByRole('dialog', { name: 'План конкретной тренировки' });
    expect(editor.getAttribute('data-read-only')).toBe('true');
    expect(screen.getByTestId('occurrence-plan-weight').textContent).toBe('70.75');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить план подхода' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить план подхода' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть план' }));
    expect(screen.queryByRole('dialog', { name: 'План конкретной тренировки' })).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
    expect(scheduled.plan.exercises[0].sets[0].plannedWeightKg).toBe(70.75);
  });
});

describe('closing a previously published workout after PLAN edits', () => {
  it.each([false, true])('offers publication and closes after the choice (publish=%s)', async publish => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    const edited = { ...draft, saved: false, previouslyPublished: true };
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue(edited);
    const close = vi.fn(), save = vi.fn(async () => undefined);
    const view = render(<OccurrenceDraftSheet draft={{ ...draft, saved: true, previouslyPublished: true }}
      drafts={drafts} onClose={close} onSave={save} />);
    view.rerender(<OccurrenceDraftSheet draft={edited} drafts={drafts} onClose={close} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(close).not.toHaveBeenCalled();
    expect(await screen.findByText('Тренировка в статусе Черновик. Перевести в статус Запланирована?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: publish ? 'Да' : 'Нет' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    if (publish) expect(save).toHaveBeenCalledWith(edited, false);
    else expect(save).not.toHaveBeenCalled();
  });

  it('keeps the editor open on failure, reports a bottom toast and allows one retry', async () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue({ ...draft, saved: false, previouslyPublished: true });
    const close = vi.fn();
    let reject!: (reason: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    render(<OccurrenceDraftSheet draft={{ ...draft, saved: false, previouslyPublished: true }}
      drafts={drafts} onClose={close} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    const yes = await screen.findByRole('button', { name: 'Да' });
    fireEvent.click(yes); fireEvent.click(yes);
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    await act(async () => reject(new Error('Не удалось опубликовать')));
    expect(screen.getByRole('alert').textContent).toContain('Не удалось опубликовать');
    expect(close).not.toHaveBeenCalled();
    save.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not close another screen after an unmounted publication completes', async () => {
    const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
    vi.spyOn(drafts, 'get').mockResolvedValue({ ...draft, saved: false, previouslyPublished: true });
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const close = vi.fn();
    const view = render(<OccurrenceDraftSheet draft={{ ...draft, saved: false, previouslyPublished: true }}
      drafts={drafts} onClose={close} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => finish());
    expect(close).not.toHaveBeenCalled();
  });
});

it('waits for accepted PLAN edits before deciding whether closing needs publication', async () => {
  const drafts = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
  const flush = vi.spyOn(drafts, 'flushEdits').mockResolvedValue(undefined);
  vi.spyOn(drafts, 'get').mockResolvedValue({ ...draft, saved: false, previouslyPublished: true });
  const close = vi.fn();
  render(<OccurrenceDraftSheet draft={{ ...draft, saved: true }} drafts={drafts} onClose={close} onSave={vi.fn()} />);
  let finish!: () => void;
  flush.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(screen.queryByRole('button', { name: 'Да' })).toBeNull();
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(await screen.findByRole('button', { name: 'Да' })).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
});
