// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

const floating = vi.hoisted(() => ({ items: [] as { id: string; onSelect?: () => void }[] }));
vi.mock('../NavigationShell', () => ({
  useNavigationSurfaceFloatingAction: (action: { popoverItems?: typeof floating.items } | null) => {
    floating.items = action?.popoverItems ?? [];
  },
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => ({ db: {}, clients: [], coaches: [] }),
}));
vi.mock('../schedule/SchedulePlanningContext', () => ({
  useSchedulePlanning: () => ({ openDraft: vi.fn() }),
}));
vi.mock('./ProgramSummary', () => ({ ProgramSummary: () => null }));
vi.mock('./PlanSyncNotice', () => ({ PlanSyncNotice: () => null }));
vi.mock('../ui', async original => {
  const actual = await original<typeof import('../ui')>();
  return { ...actual,
    SortableList: ({ items, header, footer, disabled }: React.ComponentProps<typeof actual.SortableList>) =>
      <div data-testid="sortable" data-disabled={disabled}>{header}{items.map(item => <div key={item.id}>{item.content}</div>)}{footer}</div>,
    LiquidPopover: ({ trigger, label, items = [], onPresentationChange }: React.ComponentProps<typeof actual.LiquidPopover>) =>
      <div>{trigger}<div role="menu" aria-label={label}>
        {items.map(item => <button key={item.id} disabled={item.disabled} onClick={item.onSelect}>{item.label}</button>)}
        <button onClick={() => onPresentationChange?.(false)}>Закрыть меню</button>
      </div></div>,
  };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(readOnly = false, programStatus: 'active' | 'finished' = 'active',
  phaseStatus: 'active' | 'pending' | 'draft' = readOnly ? 'active' : 'draft', hasDays = true) {
  const details: ProgramDetails = {
    program: { id: 'plan', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
      coachUserId: null, clientUserId: null, name: 'Программа', position: 0, status: programStatus,
      startedAt: null, finishedAt: null, createdAt: '', updatedAt: '' },
    phases: [{ id: 'phase', realmId: 'tg:101', owner: 'tg:101', trainingPlanId: 'plan',
      name: 'Фаза', position: 0, status: phaseStatus, plannedStartDate: null, plannedEndDate: null }],
    days: [{ day: { id: 'day', realmId: 'tg:101', owner: 'tg:101', programPhaseId: 'phase',
      name: 'День А', position: 0, status: 'active' },
      exercises: [{ exercise: { id: 'exercise', realmId: 'tg:101', owner: 'tg:101', programDayId: 'day',
        position: 0, status: 'active', notes: null,
        exercise: { exerciseDefinitionId: '0001', scope: 'public', name: 'Жим', nameEn: null, mediaUrl: null } },
        sets: [{ id: 'set', realmId: 'tg:101', owner: 'tg:101', programExerciseId: 'exercise', position: 0,
          status: 'active', plannedReps: null, plannedWeightKg: null, plannedDurationSeconds: null, plannedDistanceMeters: null }] }] }],
  };
  if (!hasDays) details.days = [];
  const observe = vi.fn((_id: string, next: (value: ProgramDetails) => void) => {
    next(details); return { unsubscribe: vi.fn() };
  });
  const repository = {
    actorUserId: 'tg:101', observeDetails: observe, observeAthleteDetails: observe,
    createDay: vi.fn(), createPhase: vi.fn(), renamePhase: vi.fn(), duration: vi.fn(),
    duplicatePhase: vi.fn(), deletePhase: vi.fn(), setPhaseStatus: vi.fn(), publishPhase: vi.fn(), activate: vi.fn(),
    editDay: vi.fn(), commentDay: vi.fn(), moveDay: vi.fn(), duplicateDay: vi.fn(), deleteDay: vi.fn(),
    addDayExercise: vi.fn(), addExerciseSet: vi.fn(), deleteDayExercise: vi.fn(), reorderDayExercises: vi.fn(),
  };
  render(<CloudProgramDetailsPage selectionMode readOnly={readOnly} repository={repository as unknown as ProgramManagementRepository}
    planId="plan" cloudStatus="ready" cloudError="" syncStatus="offline" syncError=""
    onRetryCloud={async () => {}} onRetrySync={async () => {}} />);
  return repository;
}

function notice() {
  expect(screen.getByText('Изменение планируемой тренировки будет возможно после нажатия кнопки «Запланировать».')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Планирование тренировки' })).getByRole('button', { name: 'Закрыть' }));
}

describe('program source selection', () => {
  it.each([false, true])('explains all source mutations without writing (readOnly=%s)', async readOnly => {
    const repository = setup(readOnly);
    const card = await screen.findByRole('article', { name: 'День День А' });
    expect(screen.queryByRole('button', { name: 'Начать' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Начать тренировку' })).toBeNull();
    expect(within(card).getAllByRole('button', { name: 'Запланировать' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('sortable').getAttribute('data-disabled')).toBe('true');

    for (const id of ['add-phase', 'add-day']) {
      act(() => floating.items.find(item => item.id === id)?.onSelect?.());
      notice();
    }
    const phaseMenu = screen.getByRole('menu', { name: 'Действия с фазой Фаза' });
    for (const name of ['Переименовать', 'Изменить длительность', 'Дублировать', 'Удалить', ...(!readOnly ? ['Сделать активной'] : []), 'Сменить статус']) {
      fireEvent.click(within(phaseMenu).getByRole('button', { name }));
      notice();
    }
    if (!readOnly) {
      fireEvent.click(screen.getByRole('button', { name: 'Завершить заполнение фазы' }));
      notice();
    }
    const dayMenu = within(card).getByRole('menu', { name: 'Меню дня День А' });
    for (const name of ['Переименовать', 'Вверх', 'Вниз', 'Дублировать', 'Комментарий', 'Удалить']) {
      fireEvent.click(within(dayMenu).getByRole('button', { name }));
      fireEvent.click(within(dayMenu).getByRole('button', { name: 'Закрыть меню' }));
      notice();
    }
    for (const name of ['Добавить упражнение', 'Добавить подход', 'Удалить подход 1']) {
      fireEvent.click(within(card).getByRole('button', { name }));
      notice();
    }
    fireEvent.click(screen.getByText('Подход 1'));
    notice();
    const exerciseMenu = within(card).getByRole('menu', { name: 'Меню упражнения' });
    expect(within(exerciseMenu).getByRole('button', { name: 'Информация' })).toBeTruthy();
    fireEvent.click(within(exerciseMenu).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(exerciseMenu).getByRole('button', { name: 'Закрыть меню' }));
    notice();
    for (const [key, method] of Object.entries(repository))
      if (key !== 'observeDetails' && key !== 'observeAthleteDetails' && typeof method === 'function')
        expect(method, key).not.toHaveBeenCalled();
  });
  it.each([
    ['finished', 'active', true, 'Эта программа доступна только для просмотра.'],
    ['active', 'pending', true, 'В программе нет активной доступной фазы.'],
    ['active', 'active', false, 'В активной фазе пока нет доступных дней для планирования.'],
  ] as const)('explains an unavailable assigned source (%s, %s, days=%s)', async (programStatus, phaseStatus, hasDays, message) => {
    const repository = setup(true, programStatus, phaseStatus, hasDays);
    const reason = await screen.findByRole('status');
    expect(reason.textContent).toContain(message);
    expect(screen.queryByLabelText('Подсказка')).toBeNull();
    for (const button of screen.queryAllByRole<HTMLButtonElement>('button', { name: 'Запланировать' }))
      expect(button.disabled).toBe(true);
    expect(repository.activate).not.toHaveBeenCalled();
  });

  it('does not prevent an author from using the existing activation flow', async () => {
    setup(false, 'finished', 'pending');
    await screen.findByRole('article', { name: 'День День А' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Запланировать' })
      .some(button => !button.disabled)).toBe(true);
  });

});
