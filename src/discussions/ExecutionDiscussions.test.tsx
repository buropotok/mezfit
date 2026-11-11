// @vitest-environment jsdom
import { cloneElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import type { NavigationContext } from '../NavigationShell';
import type { DiscussionAnchor } from '../../shared/discussion-anchor';
import { discussionAnchorKey } from '../../shared/discussion-anchor';
import { WorkoutSessionCard } from '../workout/WorkoutSessionCard';
import type { ActiveWorkoutSession } from '../workout/workoutSessionTypes';

const probe = vi.hoisted(() => ({ actor: 'tg:11', ensure: vi.fn(), navigations: [] as Array<NavigationContext | null> }));
const take = new File(['video'], 'Видео.mp4', { type: 'video/mp4' });
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({
  db: database, actorUserId: probe.actor, clients: [], coaches: [],
}) }));
const database = {};
vi.mock('../data/cloud/discussions', async original => ({
  ...await original<typeof import('../data/cloud/discussions')>(),
  DiscussionRepository: class {
  supportsMedia = true;
  ensureEntityThread = probe.ensure;
  observeAnchor(_anchor: DiscussionAnchor, next: (value: { unread: number }) => void) {
    next({ unread: 3 }); return { unsubscribe() {} };
  }
} }));
vi.mock('./DiscussionSheet', () => ({ DiscussionSheet: (props: {
  contextLabel: string; contextUnavailable?: boolean; anchor: DiscussionAnchor; onClose: () => void; threadId: string;
  takeRecordedVideo?: () => File | undefined;
}) => <div role="dialog" aria-label="Обсуждение" data-anchor={JSON.stringify(props.anchor)}>
  <span>{props.contextLabel}</span><span>{props.threadId}</span>
  {props.contextUnavailable && <span>Объект недоступен. История обсуждения сохранена.</span>}
  {props.takeRecordedVideo && props.threadId && <button onClick={() => {
    expect(props.takeRecordedVideo?.()).toBe(take);
    expect(props.takeRecordedVideo?.()).toBeUndefined();
  }}>Получить подтверждённое видео</button>}
  <button onClick={props.onClose}>Закрыть обсуждение</button>
</div> }));
vi.mock('./DiscussionVideoRecorder', () => ({ DiscussionVideoRecorder: ({ onCancel, onUse }: {
  onCancel: () => void; onUse: (file: File) => void;
}) => <div role="dialog" aria-label="Запись видео">
  <button onClick={onCancel}>Назад</button>
  <button onClick={() => onUse(take)}>Использовать видео</button>
</div> }));
vi.mock('../ExerciseMedia', () => ({ ExerciseMedia: () => null }));
vi.mock('../ui', async original => ({ ...await original<typeof import('../ui')>(),
  SortableList: ({ items, header, footer }: { items: Array<{ id: string | number; content: ReactNode }>; header: ReactNode; footer: ReactNode }) =>
    <>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</>,
  LiquidPopover: (props: LiquidPopoverProps) => <>
    {cloneElement(props.trigger, { onClick: () => props.onOpenChange(!props.isOpen) })}
    {props.isOpen ? <div role="menu" aria-label={props.label}>{props.items?.map(item => <button role="menuitem"
      key={item.id} disabled={item.disabled} onClick={() => {
        item.onSelect?.(); props.onOpenChange(false); props.onPresentationChange?.(false);
      }}>{item.label}{item.unreadCount ? <sup>{item.unreadCount}</sup> : null}</button>)}</div> : null}
  </>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); probe.navigations.splice(0); });
const scope = { realmId: 'pair', coachClientId: 'pair' };
const root = { kind: 'session' as const, id: 'execution' };
const exerciseAnchor = (id: string): DiscussionAnchor => ({ kind: 'exercise', workout: root, exercise: { kind: 'execution', id } });
const setAnchor = (exercise: string, id: string): DiscussionAnchor => ({ kind: 'set', workout: root,
  exercise: { kind: 'execution', id: exercise }, set: { kind: 'execution', id } });
function session(): ActiveWorkoutSession<string> {
  return { sessionId: 'execution', occurrenceId: null, status: 'completed', startedAt: '2026-11-07T10:00:00.000Z',
    completedAt: '2026-11-07T11:00:00.000Z', workoutDate: '2026-11-07', program: null, phase: null, day: null,
    discussion: { scope, anchor: { kind: 'workout', workout: root } },
    exercises: ['exercise-a', 'exercise-b'].map((id, position) => ({
      sessionExerciseId: id, workoutSessionId: 'execution', sourceProgramExerciseId: 'same-plan-exercise', position,
      discussionAnchor: exerciseAnchor(id), status: 'completed', notes: 'Техника PLAN',
      exercise: { id: 'catalogue', name: 'Жим', scope: 'global', description: null, tracking_type: 'weight_reps',
        category_code: null, equipment_code: null, reference_source: null, reference_key: null, reference_media_url: null,
        is_favourite: false, can_edit: false },
      sets: [0, 1].map(index => ({ sessionSetId: `${id}-set-${index}`, sourceProgramSetId: 'same-plan-set', position: index,
        discussionAnchor: setAnchor(id, `${id}-set-${index}`), status: 'completed', plan: null, previous: null,
        fact: { metrics: { weightKg: 50, reps: 8, durationSeconds: null, distanceMeters: null },
          setLabel: null, rpe: 8, comment: 'FACT: тяжело', bands: [] } })),
    })) };
}
const onNavigation = (value: NavigationContext | null) => { probe.navigations.push(value); };
function mount(value = session()) {
  probe.ensure.mockImplementation(async (anchor: DiscussionAnchor) => ({ id: discussionAnchorKey(scope, anchor) }));
  const props = { session: value, readOnly: true, comment: 'Заметка о тренировке', onReorderExerciseIds: vi.fn(),
    onSaveSet: vi.fn(async () => {}), onNavigationContextChange: onNavigation };
  return { ...render(<WorkoutSessionCard {...props} />), props };
}
function openFromMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Обсуждения/ }));
}

describe('COMM-07 completed execution entries', () => {
  it.each(['tg:11', 'tg:22'])('opens workout/exercise/exact set directly for %s without FACT editing', async actor => {
    probe.actor = actor;
    mount();
    expect(screen.getByText('Заметка о тренировке', { selector: 'span' })).toBeTruthy();
    openFromMenu('Меню тренировки');
    await waitFor(() => expect(probe.ensure).toHaveBeenLastCalledWith({ kind: 'workout', workout: root }, expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    // Exercises with identical names/PLAN sources still have independent execution identities.
    fireEvent.click(screen.getAllByRole('button', { name: 'Меню упражнения' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /Обсуждения/ }));
    await waitFor(() => expect(probe.ensure).toHaveBeenLastCalledWith(exerciseAnchor('exercise-a'), 'Жим'));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения подхода 2' }));
    await waitFor(() => expect(probe.ensure).toHaveBeenLastCalledWith(setAnchor('exercise-a', 'exercise-a-set-1'), 'Жим · Подход 2'));
    expect(screen.getAllByRole('dialog', { name: 'Обсуждение' })).toHaveLength(1);
    expect(screen.queryByText('Создать обсуждение')).toBeNull();
    expect(screen.getByRole('button', { name: 'Открыть подход 2' })).toBeTruthy();
    expect(screen.getAllByLabelText('Непрочитанных: 3').length).toBeGreaterThan(0);
    const menu = screen.queryByRole('menu');
    expect(menu).toBeNull();
    act(() => { probe.navigations.at(-1)?.onBack?.(); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Обсуждение' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Свернуть упражнение' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения подхода 2' }));
    await waitFor(() => expect(probe.ensure).toHaveBeenCalledTimes(4));
    expect(probe.ensure.mock.calls[2][0]).toEqual(probe.ensure.mock.calls[3][0]);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));

    // A historical FACT opens for inspection, and its nested discussion retains the exact execution set anchor.
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 2' }));
    const sheet = screen.getByRole('dialog', { name: 'Подход 2' });
    expect(within(sheet).getByText('Просмотр результата')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Изменить вес и повторения' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(sheet).queryByRole('button', { name: 'Удалить подход' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Обсуждения подхода' }));
    await waitFor(() => expect(probe.ensure).toHaveBeenCalledTimes(5));
    expect(probe.ensure).toHaveBeenLastCalledWith(setAnchor('exercise-a', 'exercise-a-set-1'), 'Жим · Подход 2');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Закрыть подход' }));
    expect(screen.queryByRole('alertdialog', { name: 'Сохранить изменения?' })).toBeNull();
  });

  it('records from the set menu and opens only that set chat on confirmation', async () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    const openCamera = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 2' }));
      expect(screen.queryByRole('menuitem', { name: /Обсуждения/ })).toBeNull();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Видео' }));
      expect(screen.getByRole('dialog', { name: 'Запись видео' })).toBeTruthy();
      expect(probe.ensure).not.toHaveBeenCalled();
    };
    openCamera();
    act(() => probe.navigations.at(-1)?.onBack?.());
    expect(screen.queryByRole('dialog', { name: 'Запись видео' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Обсуждение' })).toBeNull();
    openCamera();
    fireEvent.click(screen.getByRole('button', { name: 'Использовать видео' }));
    expect(screen.queryByRole('dialog', { name: 'Запись видео' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Получить подтверждённое видео' }));
    expect(probe.ensure).toHaveBeenCalledExactlyOnceWith(setAnchor('exercise-a', 'exercise-a-set-1'), 'Жим · Подход 2');
  });


  it('opens workout and exact set discussion from new direct icons without using the menus', async () => {
    probe.actor = 'tg:11';
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения тренировки' }));
    await waitFor(() => expect(probe.ensure).toHaveBeenLastCalledWith(
      { kind: 'workout', workout: root }, expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    const icon = screen.getByRole('button', { name: 'Обсуждения подхода 1' });
    expect(icon.closest('.ui-list-item__trailing-action')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Меню подхода 1' })).toBeTruthy();
    expect(screen.getAllByLabelText('Непрочитанных: 3').length).toBeGreaterThan(0);
    const actionRow = icon.closest('.ui-list-item-wrap');
    expect(actionRow?.querySelector('.session-exercise__icon--chevron-right')).toBeNull();
    fireEvent.click(icon);
    await waitFor(() => expect(probe.ensure).toHaveBeenLastCalledWith(
      setAnchor('exercise-a', 'exercise-a-set-0'), 'Жим · Подход 1'));
    expect(screen.getAllByRole('dialog', { name: 'Обсуждение' })).toHaveLength(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });


  it('opens a set editor discussion under the same execution anchor as its row action', async () => {
    probe.actor = 'tg:11';
    const value = { ...session(), status: 'active' as const, completedAt: null };
    probe.ensure.mockImplementation(async (anchor: DiscussionAnchor) => ({ id: discussionAnchorKey(scope, anchor) }));
    render(<WorkoutSessionCard session={value} readOnly={false}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => {})}
      onNavigationContextChange={onNavigation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    expect(screen.getByRole('dialog', { name: 'Подход 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения подхода' }));
    await waitFor(() => expect(probe.ensure).toHaveBeenLastCalledWith(
      setAnchor('exercise-a', 'exercise-a-set-0'), 'Жим · Подход 1'));
    expect(screen.getAllByRole('dialog', { name: 'Обсуждение' })).toHaveLength(1);
  });

  it.each([
    ['weight_reps', 'Дропсет', 'close button'],
    ['time', 'Кластер', 'Telegram Back'],
  ] as const)('restores the dirty %s editor Back handler after discussion %s', async (trackingType, choice, closeMethod) => {
    probe.actor = 'tg:11';
    const initial = session();
    const active: ActiveWorkoutSession<string> = {
      ...initial, status: 'active', completedAt: null,
      exercises: initial.exercises.map((exercise, index) => index === 0
        ? { ...exercise, exercise: { ...exercise.exercise, tracking_type: trackingType } }
        : exercise),
    };
    probe.ensure.mockImplementation(async (anchor: DiscussionAnchor) => ({
      id: discussionAnchorKey(scope, anchor),
    }));
    const onSaveSet = vi.fn(async () => {});
    render(<WorkoutSessionCard session={active} readOnly={false}
      onReorderExerciseIds={vi.fn()} onSaveSet={onSaveSet}
      onNavigationContextChange={onNavigation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть подход 1' }));
    await waitFor(() => expect(probe.navigations.at(-1)?.title).toBe('Подход 1'));
    fireEvent.click(screen.getByRole('button', { name: choice }));
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения подхода' }));
    await waitFor(() => expect(probe.navigations.at(-1)?.title).toBe('Жим · Подход 1'));
    expect(screen.getByRole('dialog', { name: 'Обсуждение' })).toBeTruthy();
    if (closeMethod === 'Telegram Back') act(() => { probe.navigations.at(-1)?.onBack?.(); });
    else fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждение' }));
    await waitFor(() => expect(probe.navigations.at(-1)?.title).toBe('Подход 1'));
    expect(screen.getByRole('dialog', { name: 'Подход 1' })).toBeTruthy();
    act(() => { probe.navigations.at(-1)?.onBack?.(); });
    expect(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' })).toBeTruthy();
    expect(onSaveSet).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Сохранить изменения?' }))
      .getByRole('button', { name: 'Нет' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Подход 1' })).toBeNull());
    await waitFor(() => expect(probe.navigations.at(-1)).toBeNull());
  });

  it('uses Back to dismiss set-deletion confirmation without leaving the workout', async () => {
    const value = { ...session(), status: 'active' as const, completedAt: null };
    const onDeleteSet = vi.fn(async () => {});
    render(<WorkoutSessionCard session={value} readOnly={false}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => {})}
      onDeleteSet={onDeleteSet} onNavigationContextChange={onNavigation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить подход' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Удалить подход?' });
    await waitFor(() => expect(probe.navigations.at(-1)?.title).toBe('Удалить подход?'));
    act(() => { probe.navigations.at(-1)?.onBack?.(); });
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Удалить подход?' })).toBeNull());
    await waitFor(() => expect(probe.navigations.at(-1)).toBeNull());
    expect(dialog.isConnected).toBe(false);
    expect(onDeleteSet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Меню подхода 1' })).toBeTruthy();
  });

  it('keeps deletion confirmation as the Back owner during pending work and releases it after an error', async () => {
    const value = { ...session(), status: 'active' as const, completedAt: null };
    let failDeletion: (reason: Error) => void = () => {};
    const onDeleteSet = vi.fn(() => new Promise<void>((_resolve, reject) => { failDeletion = reject; }));
    render(<WorkoutSessionCard session={value} readOnly={false}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => {})}
      onDeleteSet={onDeleteSet} onNavigationContextChange={onNavigation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить подход' }));
    await waitFor(() => expect(probe.navigations.at(-1)?.title).toBe('Удалить подход?'));
    const dialog = screen.getByRole('alertdialog', { name: 'Удалить подход?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(onDeleteSet).toHaveBeenCalledOnce();
    // Neither Back nor Cancel may dismiss the modal while its mutation is active.
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toHaveProperty('disabled', true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.getByRole('alertdialog', { name: 'Удалить подход?' })).toBeTruthy();
    act(() => { probe.navigations.at(-1)?.onBack?.(); });
    expect(screen.getByRole('alertdialog', { name: 'Удалить подход?' })).toBeTruthy();
    expect(probe.navigations.at(-1)?.title).toBe('Удалить подход?');
    await act(async () => failDeletion(new Error('Ошибка сохранения')));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Ошибка сохранения');
    act(() => { probe.navigations.at(-1)?.onBack?.(); });
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Удалить подход?' })).toBeNull());
    await waitFor(() => expect(probe.navigations.at(-1)).toBeNull());
    expect(screen.getByRole('button', { name: 'Меню подхода 1' })).toBeTruthy();
  });

  it('deletes only the selected active set through its menu after confirmation and supports retries', async () => {
    probe.actor = 'tg:11';
    const value = { ...session(), status: 'active' as const, completedAt: null };
    const onDeleteSet = vi.fn()
      .mockRejectedValueOnce(new Error('Повторите удаление'))
      .mockResolvedValueOnce(undefined);
    render(<WorkoutSessionCard session={value} readOnly={false}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => {})}
      onDeleteSet={onDeleteSet} onNavigationContextChange={onNavigation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить подход' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Удалить подход?' });
    // Document-body portals need the same canonical Konsta theme ancestry
    // as discussions; React context alone does not transport CSS selectors.
    const themeRoot = dialog.closest('.navigation-overlay-root.k-ios.dark.safe-areas');
    expect(themeRoot).not.toBeNull();
    expect(themeRoot?.parentElement).toBe(document.body);
    expect(within(dialog).getByText('Удалить подход?')).toBeTruthy();
    expect(onDeleteSet).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(onDeleteSet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить подход' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Удалить подход?' });
    const remove = within(confirmation).getByRole('button', { name: 'Удалить' });
    fireEvent.click(remove);
    fireEvent.click(remove);
    await waitFor(() => expect(onDeleteSet).toHaveBeenCalledTimes(1));
    expect(onDeleteSet).toHaveBeenCalledWith('exercise-a-set-0');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Повторите удаление');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(onDeleteSet).toHaveBeenCalledTimes(2));
    expect(onDeleteSet).toHaveBeenLastCalledWith('exercise-a-set-0');
    expect(screen.getByRole('button', { name: 'Меню подхода 2' })).toBeTruthy();
  });


  it('does not offer set deletion for completed/read-only FACT', () => {
    mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 1' }));
    expect(screen.getByRole('menu', { name: 'Меню подхода 1' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Удалить подход' })).toBeNull();
  });

  it('keeps the delete menu available for active sets with no validated discussion anchor', () => {
    const value = { ...session(), status: 'active' as const, completedAt: null,
      exercises: session().exercises.map(exercise => ({
        ...exercise,
        sets: exercise.sets.map(set => ({ ...set, discussionAnchor: undefined })),
      })) };
    const onDeleteSet = vi.fn(async () => undefined);
    render(<WorkoutSessionCard session={value} readOnly={false}
      onReorderExerciseIds={vi.fn()} onSaveSet={vi.fn(async () => {})}
      onDeleteSet={onDeleteSet} onNavigationContextChange={onNavigation} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    expect(screen.queryByRole('button', { name: 'Обсуждения подхода 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Меню подхода 1' }));
    expect(screen.getByRole('menuitem', { name: 'Удалить подход' })).toBeTruthy();
  });

  it('keeps the exact conversation during reorder and marks a deleted set unavailable instead of picking its neighbour', async () => {
    probe.actor = 'tg:11';
    const value = session();
    const view = mount(value);
    fireEvent.click(screen.getAllByRole('button', { name: 'Развернуть упражнение' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Обсуждения подхода 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Обсуждение' });
    await waitFor(() => expect(probe.ensure).toHaveBeenCalledOnce());
    view.rerender(<WorkoutSessionCard {...view.props} session={{ ...value, exercises: [...value.exercises].reverse() }} />);
    expect(dialog.getAttribute('data-anchor')).toBe(JSON.stringify(setAnchor('exercise-a', 'exercise-a-set-0')));
    const remaining = value.exercises.map(exercise => exercise.sessionExerciseId === 'exercise-a'
      ? { ...exercise, sets: exercise.sets.slice(1).map(set => ({ ...set, position: 0 })) } : exercise);
    view.rerender(<WorkoutSessionCard {...view.props} session={{ ...value, exercises: remaining }} />);
    expect(within(dialog).getByText('Объект недоступен. История обсуждения сохранена.')).toBeTruthy();
    expect(probe.ensure).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть обсуждение' }));
    expect(screen.getByRole('button', { name: 'Меню подхода 1' })).toBeTruthy();
  });
});
