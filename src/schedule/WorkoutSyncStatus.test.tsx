// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { LocalWorkoutOccurrenceDraft } from '../data/cloud/workout-occurrence-plan';
import { WorkoutOccurrenceDraftRepository } from '../data/cloud/workout-occurrence-drafts';
import type { LocalProgramSyncRow, MezfitCloudDatabase } from '../data/cloud/database';
import { WorkoutSyncStatus } from './WorkoutSyncStatus';
const state = vi.hoisted(() => ({ status: 'offline' }));
vi.mock('../data/cloud/CloudConnectionsProvider', () => ({ useCloudConnections: () => ({ syncStatus: state.status }) }));
vi.mock('../ui', () => ({ Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  LiquidPopover: ({ trigger }: { trigger: ReactNode }) => trigger }));
vi.mock('../glassSettings', () => ({ loadBrowserGlassSettings: () => ({}) }));
afterEach(cleanup);
const draft = { saved: true, targetOccurrenceId: 'one' } as LocalWorkoutOccurrenceDraft;
describe('workout synchronization capsule', () => {
  it.each([
    [true, 'offline', false, 'Нет соединения'],
    [true, 'error', false, 'Ошибка'],
    [true, 'pending', false, 'В ожидании'],
    [true, 'synced', true, 'Синхронизирована'],
    [false, 'synced', true, 'В ожидании'],
  ] as const)('projects saved=%s and sync=%s without adding a sync action', (saved, status, confirmed, label) => {
    state.status = status;
    const repository = new WorkoutOccurrenceDraftRepository({} as MezfitCloudDatabase, 'tg:101');
    vi.spyOn(repository, 'observeSync').mockImplementation((_id, next) => {
      next({ id: 'one', revision: 1, confirmedRevision: confirmed ? 1 : 0, confirmed } satisfies LocalProgramSyncRow);
      return { unsubscribe: vi.fn() };
    });
    render(<WorkoutSyncStatus draft={{ ...draft, saved }} repository={repository} />);
    expect(screen.getByRole('button', { name: `О статусе: ${label}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Синхронизировать' })).toBeNull();
  });
});
