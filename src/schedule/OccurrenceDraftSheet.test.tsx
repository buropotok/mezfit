// @vitest-environment jsdom
import type { ButtonHTMLAttributes, ReactNode, TransitionEventHandler } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutSlotConflict } from '../data/cloud/workout-slot-validation';
import { OccurrenceDraftSheet } from './OccurrenceDraftSheet';

const cloudEnabled = vi.hoisted(() => ({ value: false }));
const overlayProbe = vi.hoisted(() => ({ animated: false, zeroDuration: false, dates: 0, times: 0, dialogs: 0, selectors: 0 }));

vi.mock('./WorkoutSyncStatus', () => ({ WorkoutSyncStatus: () => null }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => cloudEnabled.value
  ? { db: {}, actorUserId: 'tg:101' } : null }));
vi.mock('../workout/WorkoutExerciseSelectionSheet', () => ({ WorkoutExerciseSelectionSheet: () => {
  overlayProbe.selectors += 1;
  return null;
} }));
vi.mock('../workout/WorkoutPlanCard', () => ({
  WorkoutPlanCard: ({ onAddSet, onExerciseInformation }: {
    onAddSet?: (id: string) => void; onExerciseInformation?: (id: string) => void;
  }) => <>
    <button onClick={() => onAddSet?.('exercise')}>Добавить подход</button>
    {onExerciseInformation ? <button onClick={() => onExerciseInformation('exercise')}>
      Информация упражнения
    </button> : null}
  </>,
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
  Avatar: () => null,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button onClick={onClick} disabled={disabled}>{children}</button>,
  IconButton: ({ label, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) =>
    <button aria-label={label} onClick={onClick} disabled={disabled} />, Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />, TimePicker: () => {
    overlayProbe.times += 1;
    return null;
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
  MezfitDialog: ({ opened, children, buttons }: { opened: boolean; children: ReactNode; buttons: ReactNode }) => {
    overlayProbe.dialogs += 1;
    return opened ? <div>{children}{buttons}</div> : null;
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
