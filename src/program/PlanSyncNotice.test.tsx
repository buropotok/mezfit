// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanSyncNotice } from './PlanSyncNotice';
import { StrictMode } from 'react';
import { createSyncNotificationBudget, SyncNotificationBudgetContext } from '../data/cloud/sync-notification-budget';

vi.mock('konsta/react', async importOriginal => {
  const actual = await importOriginal<typeof import('konsta/react')>();
  return { ...actual, Notification: ({ opened, text, onClose }: {
    opened: boolean; text: string; onClose: () => void;
  }) => opened ? <button aria-label="Закрыть уведомление" onClick={onClose}>{text}</button> : null };
});
afterEach(cleanup);
const defaults = { cloudStatus: 'ready' as const, cloudError: '', syncStatus: 'synced' as const,
  syncError: '', onRetryCloud: async () => {}, onRetrySync: async () => {} };

describe('PLAN notification cloud recovery', () => {
  it.each(['pending', 'offline', 'synced'] as const)('does not notify or spend the error budget for %s', syncStatus => {
    const budget = createSyncNotificationBudget();
    render(<SyncNotificationBudgetContext.Provider value={budget}>
      <PlanSyncNotice {...defaults} syncStatus={syncStatus} />
    </SyncNotificationBudgetContext.Provider>);
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление' })).toBeNull();
    expect(budget.claim()).toBe(true);
    expect(budget.claim()).toBe(true);
    expect(budget.claim()).toBe(true);
  });
  it('caps notifications when several program surfaces mount together', () => {
    const budget = createSyncNotificationBudget();
    render(<SyncNotificationBudgetContext.Provider value={budget}>
      {[0, 1, 2, 3, 4].map(key => <PlanSyncNotice key={key} {...defaults} syncStatus="error" />)}
    </SyncNotificationBudgetContext.Provider>);
    expect(screen.getAllByRole('button', { name: 'Закрыть уведомление' })).toHaveLength(3);
  });
  it('shares three notices across pages, survives StrictMode replay and allows notices after successful sync', () => {
    const budget = createSyncNotificationBudget();
    const page = (key: number) => <StrictMode><SyncNotificationBudgetContext.Provider value={budget}>
      <PlanSyncNotice key={key} {...defaults} syncStatus="error" />
    </SyncNotificationBudgetContext.Provider></StrictMode>;
    const view = render(page(0));
    for (let key = 0; key < 3; key++) {
      if (key) view.rerender(page(key));
      expect(screen.getByRole('button', { name: 'Закрыть уведомление' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
      expect(screen.getByText('Синхронизироваться с облаком?')).toBeTruthy();
    }
    view.rerender(page(3));
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление' })).toBeNull();
    expect(screen.queryByText('Синхронизироваться с облаком?')).toBeNull();
    budget.reset();
    view.rerender(page(4));
    expect(screen.getByRole('button', { name: 'Закрыть уведомление' })).toBeTruthy();
  });
  it('opens the synchronization dialog from notification close', () => {
    render(<PlanSyncNotice {...defaults} syncStatus="error" />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    expect(screen.getByText('Синхронизироваться с облаком?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Да' })).toBeTruthy();
  });
  it('retries pending writes and failed contacts, even if upload fails', async () => {
    const push = vi.fn(async () => { throw new Error('WRITE_DENIED'); });
    const contacts = vi.fn(async () => {}), local = vi.fn();
    render(<PlanSyncNotice {...defaults} cloudStatus="error" cloudError="CONTACTS_FAILED"
      syncStatus="error" onRetrySync={push} onRetryCloud={contacts} onRetryLocal={local} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await screen.findByText('Не удалось синхронизироваться с Mezfit облаком. Изменения сохранены на устройстве.');
    expect(screen.queryByText('WRITE_DENIED')).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(contacts).toHaveBeenCalledTimes(1);
    expect(local).toHaveBeenCalledTimes(1);
  });
  it('shows a preloader, allows dismissal and prevents a second pending upload', async () => {
    let complete!: () => void;
    const push = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    render(<PlanSyncNotice {...defaults} syncStatus="error" onRetrySync={push} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    expect(screen.getByLabelText('Синхронизация…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Да' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await act(async () => complete());
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });
  it('removes obsolete notifications on recovery and reports a later outage again', () => {
    const view = render(<PlanSyncNotice {...defaults} syncStatus="error" />);
    view.rerender(<PlanSyncNotice {...defaults} />);
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление' })).toBeNull();
    view.rerender(<PlanSyncNotice {...defaults} syncStatus="error" />);
    expect(screen.getByRole('button', { name: 'Закрыть уведомление' })).toBeTruthy();
  });
});
