// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import type { LiquidGlassTextOnlyProps } from '../ui/LiquidGlassTextOnly';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import { CloudProgramsPage } from './CloudProgramsPage';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

const actions = vi.hoisted(() => ({
  create: undefined as (() => void) | undefined,
  addPhase: undefined as (() => void) | undefined,
}));
vi.mock('../NavigationShell', () => ({
  useNavigationFloatingAction: (_surface: string, action: { onClick?: () => void }) => {
    actions.create = action.onClick;
  },
  useNavigationSurfaceFloatingAction: (action: { popoverItems?: Array<{ id: string; onSelect?: () => void }> } | null) => {
    actions.addPhase = action?.popoverItems?.find((item) => item.id === 'add-phase')?.onSelect;
  },
}));

vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ tabs, value, onValueChange }: LiquidGlassTextOnlyProps) => (
    <div role="tablist">{tabs.map((tab) => <button key={tab.value} role="tab"
      aria-selected={tab.value === value} onClick={() => onValueChange(tab.value)}>{tab.label}</button>)}</div>
  ),
}));
vi.mock('../ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ui')>(),
  LiquidPopover: ({ label, items = [] }: LiquidPopoverProps) => <div>
    {items.map((item) => <button key={item.id} disabled={item.disabled}
      aria-label={`${label}: ${item.id}`} onClick={item.onSelect}>{item.label}</button>)}
  </div>,
}));

beforeEach(() => {
  actions.create = undefined;
  actions.addPhase = undefined;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function plan(id: string, personal = true): CloudTrainingPlanRow {
  return {
    id, realmId: personal ? 'tg:101' : 'rlm-pair', owner: 'tg:101',
    athleteUserId: personal ? 'tg:101' : 'tg:202',
    coachUserId: personal ? null : 'tg:101', clientUserId: personal ? null : 'tg:202',
    name: id, position: 0, status: 'draft', startedAt: null, finishedAt: null,
    createdAt: '', updatedAt: '',
  };
}
function details(program: CloudTrainingPlanRow): ProgramDetails {
  return { program, phases: [{
    id: 'phase', realmId: program.realmId, owner: 'tg:101', trainingPlanId: program.id,
    name: 'Первая фаза', status: 'pending', position: 0, durationWeeks: 21,
    plannedStartDate: null, plannedEndDate: null,
  }] };
}
const connection = {
  cloudStatus: 'ready' as const, cloudError: '', syncStatus: 'synced' as const, syncError: '',
  onRetryCloud: async () => {}, onRetrySync: async () => {},
};
const clients = [{ userId: 'tg:202', telegramUserId: '202', relationshipId: 'rlm-pair', displayName: 'Анна' }];
function repository(rows: CloudTrainingPlanRow[]) {
  return {
    actorUserId: 'tg:101',
    observeAuthored: (next: (rows: CloudTrainingPlanRow[]) => void) => {
      next(rows); return { unsubscribe: vi.fn() };
    },
    observeDetails: (_id: string, next: (value: ProgramDetails) => void) => {
      next(details(rows[0])); return { unsubscribe: vi.fn() };
    },
    details: async (id: string) => details(rows.find((row) => row.id === id)!),
    listReadable: async () => rows,
    activate: vi.fn(async () => {}),
    setPhaseStatus: vi.fn(async () => {}),
  };
}

describe('program workspace regressions', () => {
  it('keeps save enabled and validates an empty program name only after tapping save', async () => {
    const repo = repository([]);
    render(<CloudProgramsPage repository={repo as unknown as ProgramManagementRepository}
      clients={[]} onOpen={() => {}} {...connection} />);
    // Invoke the action registered with the navigation owner, not a parallel button.
    act(() => actions.create?.());
    const prompt = screen.getByRole('dialog', { name: 'Создать программу' });
    const save = within(prompt).getByRole('button', { name: 'Сохранить' });
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(within(prompt).queryByText('Обязательно к заполнению')).toBeNull();
    fireEvent.click(save);
    expect(within(prompt).getByText('Обязательно к заполнению')).toBeTruthy();
    fireEvent.change(within(prompt).getByRole('textbox', { name: 'Название' }), { target: { value: 'Новая' } });
    expect(within(prompt).queryByText('Обязательно к заполнению')).toBeNull();
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  it('shows a failed local phase write alongside an unconfirmed cloud sync', async () => {
    const repo = { ...repository([plan('Программа')]), createPhase: vi.fn(async () => { throw new Error('Фаза не сохранена'); }) };
    render(<CloudProgramDetailsPage repository={repo as unknown as ProgramManagementRepository}
      planId="Программа" {...connection} syncStatus="pending" />);
    await screen.findByText('Программа тренировок');
    act(() => actions.addPhase?.());
    const prompt = screen.getByRole('dialog', { name: 'Добавить фазу' });
    const save = within(prompt).getByRole('button', { name: 'Сохранить' });
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(within(prompt).getByText('Обязательно к заполнению')).toBeTruthy();
    expect(repo.createPhase).not.toHaveBeenCalled();
    fireEvent.change(within(prompt).getByRole('textbox', { name: 'Название' }), { target: { value: 'Новая фаза' } });
    fireEvent.click(save);
    expect(await within(prompt).findByRole('alert')).toHaveProperty('textContent', 'Фаза не сохранена');
    expect(screen.getByRole('status').textContent).toContain('ещё не подтверждена');
    expect(repo.createPhase).toHaveBeenCalledWith('Программа', 'Новая фаза');
  });

  it('puts personal programs first and filters individual titles or athlete names', async () => {
    const repo = repository([plan('Бег', false), plan('Сила', false), plan('Личная')]);
    render(<CloudProgramsPage repository={repo as unknown as ProgramManagementRepository}
      clients={clients} onOpen={() => {}} {...connection} />);
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((node) => node.textContent)).toEqual(['Мои программы', 'Анна']);
    expect(screen.queryByLabelText('Поиск программы или атлета')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Поиск программ' }));
    const search = screen.getByLabelText('Поиск программы или атлета');
    fireEvent.change(search, { target: { value: 'бег' } });
    expect(screen.getByText('Бег')).toBeTruthy();
    expect(screen.queryByText('Сила')).toBeNull();
    fireEvent.change(search, { target: { value: 'анна' } });
    expect(screen.getByText('Сила')).toBeTruthy();
    expect(screen.queryByText('Личная')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Активные' }));
    expect(screen.queryByText('Бег')).toBeNull();
    expect(screen.queryByText('Сила')).toBeNull();
  });

  it('activates a single phase directly, retaining the other program disposition prompt', async () => {
    const rows = [plan('Новая'), { ...plan('Текущая'), status: 'active' as const }];
    const repo = repository(rows);
    render(<CloudProgramsPage repository={repo as unknown as ProgramManagementRepository}
      clients={[]} onOpen={() => {}} {...connection} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Меню программы Новая: activate' }));
    const prompt = await screen.findByRole('dialog', { name: 'Выберите статус для текущей активной программы' });
    expect(screen.queryByRole('dialog', { name: 'Выберите фазу для активации' })).toBeNull();
    fireEvent.click(within(prompt).getByText('Завершена'));
    await waitFor(() => expect(within(prompt).getByRole('button', { name: 'Подтвердить' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(within(prompt).getByRole('button', { name: 'Подтвердить' }));
    await waitFor(() => expect(repo.activate).toHaveBeenCalledWith('Новая', 'phase', { previousProgramStatus: 'finished' }));
  });

  it('activates a lone program without opening a phase chooser', async () => {
    const repo = repository([plan('Одна')]);
    render(<CloudProgramsPage repository={repo as unknown as ProgramManagementRepository}
      clients={[]} onOpen={() => {}} {...connection} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Меню программы Одна: activate' }));
    await waitFor(() => expect(repo.activate).toHaveBeenCalledWith('Одна', 'phase'));
    expect(screen.queryByRole('dialog', { name: 'Выберите фазу для активации' })).toBeNull();
  });

  it.each(['coach', 'client'] as const)('limits client visibility guidance in %s context', async (viewerRole) => {
    const assigned = { ...plan('Программа', false), status: 'active' as const };
    const repo = repository([assigned]);
    render(<CloudProgramDetailsPage repository={repo as unknown as ProgramManagementRepository}
      planId={assigned.id} viewerRole={viewerRole} actor={{ name: 'Андрей', photoUrl: '/avatar.jpg' }} {...connection} />);
    expect(await screen.findByText('Владелец: Андрей')).toBeTruthy();
    expect(screen.getByLabelText('Аватар владельца: Андрей').querySelector('img')?.getAttribute('src')).toBe('/avatar.jpg');
    expect(screen.queryByText(/tg:202/)).toBeNull();
    expect(screen.queryByText(/Клиент видит только/) !== null).toBe(viewerRole === 'coach');
    fireEvent.click(screen.getByRole('button', { name: 'Действия с фазой Первая фаза: status' }));
    const prompt = screen.getByRole('dialog', { name: 'Сменить статус фазы' });
    fireEvent.click(within(prompt).getByText('Черновик'));
    fireEvent.click(within(prompt).getByRole('button', { name: 'Подтвердить' }));
    if (viewerRole === 'coach') {
      expect(await screen.findByRole('dialog', { name: 'Скрыть фазу от клиента?' })).toBeTruthy();
      expect(repo.setPhaseStatus).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(repo.setPhaseStatus).toHaveBeenCalledWith('Программа', 'phase', 'draft'));
      expect(screen.queryByRole('dialog', { name: 'Скрыть фазу от клиента?' })).toBeNull();
    }
  });
});
