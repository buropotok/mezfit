// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

vi.mock('./ProgramSyncControls', () => ({ ProgramSyncControls: () => null }));
vi.mock('konsta/react', async importOriginal => {
  const actual = await importOriginal<typeof import('konsta/react')>();
  return { ...actual, Notification: ({ opened, text, onClose }: {
    opened: boolean; text: string; onClose: () => void;
  }) => opened ? <button aria-label="Закрыть уведомление" onClick={onClose}>{text}</button> : null };
});
const details: ProgramDetails = { program: {
  id: 'tra-1', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
  coachUserId: null, clientUserId: null, name: 'Моя программа', position: 0, status: 'draft',
  startedAt: null, finishedAt: null, createdAt: '2026-10-15', updatedAt: '2026-10-15',
}, phases: [] };
afterEach(cleanup);

describe('PLAN details cloud connection status', () => {
  it('uses notification recovery while keeping cached details available', async () => {
    const repository = { observeDetails: (_id: string, next: (value: ProgramDetails) => void) => {
      next(details); return { unsubscribe: vi.fn() };
    } } as unknown as ProgramManagementRepository;
    const retry = vi.fn(async () => {});
    const page = (syncStatus: 'synced' | 'pending' | 'offline' | 'error') =>
      <CloudProgramDetailsPage repository={repository} planId="tra-1"
        cloudStatus="ready" cloudError="" syncStatus={syncStatus}
        syncError={syncStatus === 'error' ? 'Изменение отклонено сервером' : ''}
        onRetryCloud={retry} onRetrySync={retry} />;
    const view = render(page('synced'));
    expect(await screen.findByText('Моя программа')).toBeTruthy();
    view.rerender(page('error'));
    expect(screen.getByText('Изменение отклонено сервером')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизироваться' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    view.rerender(page('offline'));
    expect(screen.getByText('Нет соединения с Dexie Cloud')).toBeTruthy();
    view.rerender(page('pending'));
    expect(screen.getByText('Синхронизация с облаком ещё не подтверждена.')).toBeTruthy();
    view.rerender(page('synced'));
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление' })).toBeNull();
  });
});
