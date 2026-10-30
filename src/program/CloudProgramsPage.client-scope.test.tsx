// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import { CloudProgramsPage } from './CloudProgramsPage';

vi.mock('../NavigationShell', () => ({
  useNavigationFloatingAction: vi.fn(),
}));

const client = { userId: 'tg:202', telegramUserId: '202', relationshipId: 'realm-202', displayName: 'Анна' };
const connection = {
  cloudStatus: 'ready' as const, cloudError: '', syncStatus: 'synced' as const, syncError: '',
  onRetryCloud: async () => {}, onRetrySync: async () => {},
};

function plan(id: string, coachUserId: string | null, clientUserId: string | null, realmId: string): CloudTrainingPlanRow {
  return {
    id, name: id, coachUserId, clientUserId, realmId, owner: null,
    athleteUserId: clientUserId ?? 'tg:101',
    position: 0, status: 'draft', startedAt: null, finishedAt: null,
    createdAt: '', updatedAt: '',
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CloudProgramsPage client relationship scope', () => {
  it('shows every authored program for the selected client and relationship while preserving normal row opening', async () => {
    const first = plan('Первая программа', 'tg:101', client.userId, client.relationshipId);
    const second = { ...plan('Вторая программа', 'tg:101', client.userId, client.relationshipId), status: 'finished' as const };
    const excluded = [
      plan('Чужой тренер', 'tg:999', client.userId, client.relationshipId),
      plan('Другой клиент', 'tg:101', 'tg:303', client.relationshipId),
      plan('Другая связь', 'tg:101', client.userId, 'realm-other'),
      plan('Личная программа', null, null, 'tg:101'),
    ];
    const unsubscribe = vi.fn();
    const repo = {
      actorUserId: 'tg:101',
      observeAuthored: (next: (plans: CloudTrainingPlanRow[]) => void) => {
        next([first, second, ...excluded]);
        return { unsubscribe };
      },
    };
    const onOpen = vi.fn();
    const view = render(<CloudProgramsPage repository={repo as unknown as ProgramManagementRepository}
      clients={[client]} clientScope={client} hideToolbar onOpen={onOpen} {...connection} />);

    expect(await screen.findByText(first.name)).toBeTruthy();
    expect(screen.getByText(second.name)).toBeTruthy();
    for (const item of excluded) expect(screen.queryByText(item.name)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Мои программы' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Программы клиентов' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Поиск программ' })).toBeNull();

    const card = view.container.querySelector<HTMLElement>('.cloud-plan-group-surface');
    expect(card?.style.getPropertyValue('--ui-glass-surface-blur')).toBe('2px');
    fireEvent.click(screen.getByText(first.name));
    expect(onOpen).toHaveBeenCalledWith(first);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('shows an accurate empty state after a settled local subscription', async () => {
    const repo = {
      actorUserId: 'tg:101',
      observeAuthored: (next: (plans: CloudTrainingPlanRow[]) => void) => {
        next([plan('Другая связь', 'tg:101', client.userId, 'realm-other')]);
        return { unsubscribe: vi.fn() };
      },
    };
    render(<CloudProgramsPage repository={repo as unknown as ProgramManagementRepository}
      clients={[client]} clientScope={client} hideToolbar onOpen={vi.fn()} {...connection} />);
    expect(await screen.findByText('Программ с выбранными параметрами нет')).toBeTruthy();
    expect(screen.queryByText('Другая связь')).toBeNull();
  });
});
