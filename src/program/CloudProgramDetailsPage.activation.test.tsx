// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiquidPopoverProps } from '../ui/LiquidPopover';
import type { ProgramDetails, ProgramManagementRepository } from '../data/cloud/program-management';
import { CloudProgramDetailsPage } from './CloudProgramDetailsPage';

// Exercise the page/dialog ownership without waiting for the popover's optical animation.
vi.mock('../ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui')>();
  return {
    ...actual,
    LiquidPopover: ({ label, items = [] }: LiquidPopoverProps) => <div>
      {items.map((item) => <button key={item.id} disabled={item.disabled}
        aria-label={`${label}: ${item.id}`} onClick={item.onSelect}>{item.label}</button>)}
    </div>,
  };
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const details: ProgramDetails = {
  program: {
    id: 'plan', realmId: 'tg:101', owner: 'tg:101', athleteUserId: 'tg:101',
    coachUserId: null, clientUserId: null, name: 'Программа', position: 0, status: 'active',
    startedAt: null, finishedAt: null, createdAt: '', updatedAt: '',
  },
  phases: (['active', 'pending'] as const).map((status, index) => ({
    id: `phase-${index}`, realmId: 'tg:101', owner: 'tg:101', trainingPlanId: 'plan',
    name: `Фаза ${index + 1}`, position: index, status,
    plannedStartDate: null, plannedEndDate: null,
  })),
};

describe('phase activation async ownership', () => {
  it.each(['activate', 'status'] as const)(
    'keeps %s confirmation locked until activation settles and lets a failed operation retry', async (entry) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const activate = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; }));
      const repository = {
        observeDetails: (_id: string, next: (value: ProgramDetails) => void) => {
          next(details);
          return { unsubscribe: vi.fn() };
        },
        listReadable: async () => [details.program],
        activate,
      } as unknown as ProgramManagementRepository;
      render(<CloudProgramDetailsPage repository={repository} planId="plan"
        cloudStatus="ready" cloudError="" syncStatus="synced" syncError=""
        onRetryCloud={async () => {}} onRetrySync={async () => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: `Действия с фазой Фаза 2: ${entry}` }));
      if (entry === 'status') {
        const statusDialog = screen.getByRole('dialog', { name: 'Сменить статус фазы' });
        fireEvent.click(within(statusDialog).getByText('Активная'));
        fireEvent.click(within(statusDialog).getByRole('button', { name: 'Подтвердить' }));
      }
      const dialog = await screen.findByRole('dialog', { name: 'Выберите статус для текущей активной фазы' });
      const confirm = within(dialog).getByRole('button', { name: 'Подтвердить' });
      fireEvent.click(confirm);
      await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
      const pending = within(dialog).getByRole('button', { name: 'Сохранение…' });
      const cancel = within(dialog).getByRole('button', { name: 'Отмена' });
      expect(pending.hasAttribute('disabled')).toBe(true);
      expect(cancel.hasAttribute('disabled')).toBe(true);
      fireEvent.click(pending);
      fireEvent.click(cancel);
      expect(activate).toHaveBeenCalledTimes(1);
      await act(async () => reject(new Error('Не удалось активировать фазу')));
      expect(within(dialog).getByRole('alert').textContent).toContain('Не удалось активировать фазу');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }));
      await waitFor(() => expect(activate).toHaveBeenCalledTimes(2));
      await act(async () => resolve());
      // Konsta retains a closed shell for transitions; the working dialog must close.
      await waitFor(() => expect(screen.queryByRole('dialog', {
        name: 'Выберите статус для текущей активной фазы',
      })).toBeNull());
      expect(screen.queryByText('Не удалось активировать фазу')).toBeNull();
    },
  );
});
