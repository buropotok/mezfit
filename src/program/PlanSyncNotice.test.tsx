// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanSyncNotice } from './PlanSyncNotice';

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
  it('opens the synchronization dialog from notification close', () => {
    render(<PlanSyncNotice {...defaults} syncStatus="offline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    expect(screen.getByText('Синхронизируйтесь с облаком')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Синхронизироваться' })).toBeTruthy();
  });
  it('retries pending writes and failed contacts, even if upload fails', async () => {
    const push = vi.fn(async () => { throw new Error('WRITE_DENIED'); });
    const contacts = vi.fn(async () => {}), local = vi.fn();
    render(<PlanSyncNotice {...defaults} cloudStatus="error" cloudError="CONTACTS_FAILED"
      syncStatus="error" onRetrySync={push} onRetryCloud={contacts} onRetryLocal={local} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизироваться' }));
    await screen.findByText('WRITE_DENIED');
    expect(push).toHaveBeenCalledTimes(1);
    expect(contacts).toHaveBeenCalledTimes(1);
    expect(local).toHaveBeenCalledTimes(1);
  });
  it('shows a preloader, allows dismissal and prevents a second pending upload', async () => {
    let complete!: () => void;
    const push = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    render(<PlanSyncNotice {...defaults} syncStatus="offline" onRetrySync={push} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }));
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизироваться' }));
    expect(screen.getByLabelText('Синхронизация…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Синхронизироваться' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await act(async () => complete());
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });
  it('removes obsolete notifications on recovery and reports a later outage again', () => {
    const view = render(<PlanSyncNotice {...defaults} syncStatus="offline" />);
    view.rerender(<PlanSyncNotice {...defaults} />);
    expect(screen.queryByRole('button', { name: 'Закрыть уведомление' })).toBeNull();
    view.rerender(<PlanSyncNotice {...defaults} syncStatus="offline" />);
    expect(screen.getByRole('button', { name: 'Закрыть уведомление' })).toBeTruthy();
  });
});
