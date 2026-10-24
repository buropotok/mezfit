// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { LocalProgramSyncRow } from '../data/cloud/database';
import type { PersonalEventRepository } from '../data/cloud/personal-events';
import { PersonalEventStatuses } from './PersonalEventStatuses';

const cloud = vi.hoisted(() => ({
  current: { db: {}, syncStatus: 'synced' as 'synced' | 'offline' | 'error' },
}));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({
  useCloudConnections: () => cloud.current,
}));
vi.mock('../glassSettings', () => ({
  loadBrowserGlassSettings: () => ({ preset: 'default', optics: {} }),
}));
vi.mock('../ui', () => ({
  Badge: ({ children, color }: { children: ReactNode; color: string }) =>
    <span data-badge-color={color}>{children}</span>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

afterEach(cleanup);

it('labels unsaved events as drafts without falsely claiming cloud synchronization', () => {
  render(<PersonalEventStatuses eventId={null} repository={null} />);
  expect(screen.getByText('Не сохранено')).not.toBeNull();
  expect(screen.getByText('Черновик')).not.toBeNull();
  expect(screen.queryByText('Синхронизирована')).toBeNull();
});

it('keeps published state separate from pending, offline and confirmed sync', () => {
  const subscription = { emit: null as ((row: LocalProgramSyncRow | undefined) => void) | null };
  const repository = {
    observeSync: (_id: string, onChange: (row: LocalProgramSyncRow | undefined) => void) => {
      subscription.emit = onChange;
      return { unsubscribe: () => { subscription.emit = null; } };
    },
  } as unknown as PersonalEventRepository;
  const view = render(<PersonalEventStatuses eventId="event-1" repository={repository} />);
  expect(screen.getByText('Запланировано')).not.toBeNull();
  expect(screen.getByText('В ожидании')).not.toBeNull();

  act(() => { subscription.emit?.({ id: 'event-1', revision: 1, confirmedRevision: 1, confirmed: true }); });
  expect(screen.getByText('Синхронизирована')).not.toBeNull();

  act(() => { subscription.emit?.({ id: 'event-1', revision: 2, confirmedRevision: 1, confirmed: true }); });
  cloud.current.syncStatus = 'offline';
  view.rerender(<PersonalEventStatuses eventId="event-1" repository={repository} />);
  expect(screen.getByText('Нет соединения')).not.toBeNull();
  expect(screen.getByText('Запланировано')).not.toBeNull();

  cloud.current.syncStatus = 'synced';
  view.rerender(<PersonalEventStatuses eventId="event-1" repository={repository} />);
});
