// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudConnections, type CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { ProgramManagementRepository, type ProgramDetails } from '../data/cloud/program-management';
import { useClientCoach } from './ClientCoachContext';
import { ClientProgramsPage } from './ClientProgramsPage';

vi.mock('../data/cloud/program-management-activation', () => ({ CLOUD_PROGRAM_MANAGEMENT_ENABLED: true }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: vi.fn() }));
vi.mock('./ClientCoachContext', () => ({ useClientCoach: vi.fn() }));

const coach = (id: string): CloudContact => ({
  userId: `tg:${id}`, telegramUserId: id, relationshipId: `rlm-${id}`, displayName: `Тренер ${id}`,
});
function details(id: string): ProgramDetails {
  return {
    program: {
      id: `plan-${id}`, realmId: `rlm-${id}`, owner: `tg:${id}`,
      coachUserId: `tg:${id}`, clientUserId: 'tg:101', name: `Программа ${id}`,
      position: 0, status: 'active', startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
    },
    phases: [],
  };
}
const refresh = vi.fn(async () => undefined);
const retrySync = vi.fn(async () => undefined);
let onOldChange: ((data: ProgramDetails | null) => void) | undefined;
let onNewError: ((reason: unknown) => void) | undefined;
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onOldChange = undefined;
  onNewError = undefined;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(useCloudConnections).mockReturnValue({
    db: {} as NonNullable<ReturnType<typeof useCloudConnections>>['db'],
    actorUserId: 'tg:101', clients: [], coaches: [coach('202'), coach('303')],
    status: 'ready', error: '', syncStatus: 'offline', syncError: 'Нет сети',
    refresh, retrySync, loadAvatar: async () => null,
  });
  vi.mocked(useClientCoach).mockReturnValue({
    coaches: [coach('202'), coach('303')], selectedCoach: coach('202'),
    status: 'ready', error: '', selectCoach: vi.fn(), refreshCoaches: vi.fn(),
  });
  vi.spyOn(ProgramManagementRepository.prototype, 'observeActiveForAthlete')
    .mockImplementation((_actor, coachId, next, error) => {
      if (coachId === 'tg:202') { onOldChange = next; next(details('202')); }
      else onNewError = error;
      return { unsubscribe, closed: false };
    });
  vi.spyOn(ProgramManagementRepository.prototype, 'observePersonal').mockImplementation((next) => {
    next([]);
    return { unsubscribe: vi.fn(), closed: false };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('client PLAN workspace integration', () => {
  it('shows real sync failures and retries queued writes on both client tabs', async () => {
    render(<ClientProgramsPage />);
    expect(await screen.findByText('Программа 202')).toBeTruthy();
    expect(screen.getByText('Нет сети')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить синхронизацию' }));
    await waitFor(() => expect(retrySync).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Мои программы' }), { button: 0, ctrlKey: false });
    expect(await screen.findByText('Нет сети')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить синхронизацию' }));
    await waitFor(() => expect(retrySync).toHaveBeenCalledTimes(2));
  });

  it('never shows the previous coach program after switching, late emission or observer failure', async () => {
    const view = render(<ClientProgramsPage />);
    expect(await screen.findByText('Программа 202')).toBeTruthy();
    const current = vi.mocked(useClientCoach)();
    vi.mocked(useClientCoach).mockReturnValue({ ...current, selectedCoach: coach('303') });
    view.rerender(<ClientProgramsPage />);
    expect(screen.queryByText('Программа 202')).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
    act(() => {
      onOldChange?.(details('202'));
      onNewError?.(new Error('Не удалось открыть программу 303'));
    });
    expect(screen.queryByText('Программа 202')).toBeNull();
    expect(screen.getByText('Не удалось открыть программу 303')).toBeTruthy();
  });
});
