// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudTrainingPlanRow } from '../data/cloud/database';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

const personalPlan: CloudTrainingPlanRow = {
  id: 'tra-1', realmId: 'tg:101', owner: 'tg:101',
  athleteUserId: 'tg:101', coachUserId: null, clientUserId: null,
  name: 'Моя программа', position: 0, status: 'draft',
  startedAt: null, finishedAt: null,
  createdAt: '2026-10-15', updatedAt: '2026-10-15',
};

const details: ProgramDetails = { program: personalPlan, phases: [] };

afterEach(cleanup);

describe('PLAN details cloud connection status', () => {
  it('warns that offline edits are not cloud-confirmed, retries, and clears on recovery', async () => {
    const observeDetails = vi.fn((
      _id: string,
      onChange: (data: ProgramDetails | null) => void,
    ) => {
      onChange(details);
      return { unsubscribe: vi.fn() };
    });
    const repository = { observeDetails } as unknown as ProgramManagementRepository;
    const retry = vi.fn(async () => undefined);
    const page = (
      syncStatus: 'synced' | 'pending' | 'offline' | 'error',
      cloudStatus: 'ready' | 'error' = 'ready',
    ) => (
      <CloudProgramDetailsPage
        repository={repository} planId={personalPlan.id}
        cloudStatus={cloudStatus} cloudError={cloudStatus === 'error' ? 'Контакты недоступны' : ''}
        syncStatus={syncStatus} syncError={syncStatus === 'error' ? 'Изменение отклонено сервером' : ''}
        onRetryCloud={retry}
      />
    );

    const view = render(page('synced'));
    expect(await screen.findByText('Моя программа')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    // Contacts are still ready but the actual PLAN push failed.
    view.rerender(page('error'));
    expect(screen.getByRole('alert').textContent).toContain('Изменение отклонено сервером');
    expect(screen.getByText(/Изменения могут оставаться только на этом устройстве/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить синхронизацию' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));

    view.rerender(page('offline'));
    expect(screen.getByRole('alert').textContent).toContain('Нет соединения с Dexie Cloud');

    view.rerender(page('pending'));
    expect(screen.getByRole('status').textContent).toContain('не подтверждена');
    expect(screen.queryByRole('button', { name: 'Повторить синхронизацию' })).toBeNull();

    view.rerender(page('synced'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    view.rerender(page('synced', 'error'));
    expect(screen.getByRole('alert').textContent).toContain('Контакты недоступны');
  });
});
