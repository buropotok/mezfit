// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanSyncNotice } from './PlanSyncNotice';

afterEach(cleanup);
const defaults = {
  cloudStatus: 'ready' as const, cloudError: '',
  syncStatus: 'synced' as const, syncError: '',
  onRetryCloud: async () => undefined, onRetrySync: async () => undefined,
};

describe('shared PLAN confirmation and recovery', () => {
  it('keeps cached data honest through pending, offline, denial and recovery', () => {
    const view = render(<PlanSyncNotice {...defaults} />);
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(<PlanSyncNotice {...defaults} syncStatus="pending" />);
    expect(screen.getByRole('status').textContent).toContain('не подтверждена');
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<PlanSyncNotice {...defaults} syncStatus="offline" />);
    expect(screen.getByRole('alert').textContent).toContain('Нет соединения');
    view.rerender(<PlanSyncNotice {...defaults} syncStatus="error" syncError="PLAN_WRITE_DENIED" />);
    expect(screen.getByRole('alert').textContent).toContain('PLAN_WRITE_DENIED');
    view.rerender(<PlanSyncNotice {...defaults} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries pending writes AND failed contacts, including when pushing fails', async () => {
    const push = vi.fn(async () => { throw new Error('WRITE_DENIED'); });
    const contacts = vi.fn(async () => undefined);
    const local = vi.fn();
    render(<PlanSyncNotice {...defaults} cloudStatus="error" cloudError="CONTACTS_FAILED"
      syncStatus="error" onRetrySync={push} onRetryCloud={contacts} onRetryLocal={local} />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить синхронизацию' }));
    await screen.findByText('WRITE_DENIED');
    expect(push).toHaveBeenCalledTimes(1);
    expect(contacts).toHaveBeenCalledTimes(1);
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('retries writes without refreshing healthy contacts and blocks duplicate taps', async () => {
    let complete!: () => void;
    const push = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
    const contacts = vi.fn(async () => undefined);
    render(<PlanSyncNotice {...defaults} syncStatus="offline" onRetrySync={push} onRetryCloud={contacts} />);
    const button = screen.getByRole('button', { name: 'Повторить синхронизацию' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(push).toHaveBeenCalledTimes(1);
    await act(async () => complete());
    await waitFor(() => expect(screen.getByRole('button').textContent).toContain('Повторить'));
    expect(contacts).not.toHaveBeenCalled();
    // Resolving retry does not fabricate a synced state.
    expect(screen.getByRole('alert').textContent).toContain('Нет соединения');
  });
});
