// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cloneElement } from 'react';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { ProgramManagementRepository } from '../data/cloud/program-management';
import { ProgramSyncControls } from './ProgramSyncControls';

vi.mock('../ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../ui')>();
  return { ...actual,
    LiquidPopover: ({ trigger, isOpen, onOpenChange, text }: LiquidPopoverProps) => <>
      {cloneElement(trigger, { onClick: () => onOpenChange(!isOpen) })}
      {isOpen ? <div role="dialog">{text}</div> : null}
    </>,
    GlassSurface: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) =>
    <button onClick={onClick}>{children}</button> };
});
afterEach(cleanup);
function fixture(row: LocalProgramSyncRow) {
  let emit!: (next: LocalProgramSyncRow) => void;
  const unsubscribe = vi.fn();
  const repository = { observeSync: (_id: string, next: typeof emit) => {
    emit = next; next(row); return { unsubscribe };
  } } as unknown as ProgramManagementRepository;
  return { repository, emit: (next: LocalProgramSyncRow) => emit(next), unsubscribe };
}
describe('program cloud status pills', () => {
  it('keeps a confirmed program green while global sync is offline or failing', () => {
    const f = fixture({ id: 'a', revision: 2, confirmedRevision: 2, confirmed: true });
    const page = (syncStatus: 'offline' | 'error') => <ProgramSyncControls repository={f.repository}
      planId="a" syncStatus={syncStatus} onSync={async () => {}} />;
    const view = render(page('offline'));
    expect(screen.getByText('Синхронизирована').className).toContain('ui-badge--green');
    view.rerender(page('error'));
    expect(screen.getByText('Синхронизирована').className).toContain('ui-badge--green');
    act(() => f.emit({ id: 'a', revision: 3, confirmedRevision: 2, confirmed: true }));
    expect(screen.getByText('Ошибка').className).toContain('ui-badge--red');
    view.unmount();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it('uses gray for pending offline changes and opens manual synchronization', () => {
    const f = fixture({ id: 'a', revision: 1, confirmedRevision: 0, confirmed: false });
    const navigation = vi.fn();
    render(<ProgramSyncControls repository={f.repository} planId="a" syncStatus="offline"
      onSync={async () => {}} onNavigationContextChange={navigation} />);
    expect(screen.getByText('Нет соединения').className).toContain('ui-badge--gray');
    fireEvent.click(screen.getByRole('button', { name: 'Синхронизировать' }));
    expect(screen.getByText('Синхронизироваться с облаком?')).toBeTruthy();
    expect(navigation.mock.lastCall?.[0].title).toBe('Синхронизация');
    act(() => navigation.mock.lastCall?.[0].onBack());
    expect(screen.queryByText('Синхронизироваться с облаком?')).toBeNull();
    expect(navigation.mock.lastCall?.[0]).toBeNull();
  });
});

it('explains the status from the badge without technical errors or a separate info button', () => {
  const f = fixture({ id: 'a', revision: 2, confirmedRevision: 1, confirmed: true });
  render(<ProgramSyncControls repository={f.repository} planId="a" syncStatus="error" onSync={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'О статусе: Ошибка' }));
  expect(screen.getByRole('dialog').textContent).toContain('изменения');
  expect(screen.getByRole('dialog').textContent).toContain('сохранены на устройстве');
  expect(screen.getByRole('dialog').textContent).not.toContain('Dexie');
  expect(screen.queryByRole('button', { name: 'О синхронизации программы' })).toBeNull();
});
