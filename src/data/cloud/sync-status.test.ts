import { describe, expect, it } from 'vitest';
import { itemSyncStatus, projectDexieSyncState, syncStatusColor, syncStatusLabel } from './sync-status';
import type { MezfitCloudDatabase } from './database';
type State = MezfitCloudDatabase['cloud']['syncState']['value'];

describe('unified phase-driven sync statuses', () => {
  it.each([
    ['initial', 'offline', 'local'], ['not-in-sync', 'connected', 'local'],
    ['offline', 'offline', 'local'], ['pushing', 'offline', 'syncing'],
    ['pulling', 'offline', 'syncing'], ['in-sync', 'offline', 'synced'],
    ['in-sync', 'disconnected', 'synced'], ['in-sync', 'connected', 'synced'],
    ['error', 'offline', 'error'],
  ] as const)('projects %s / %s to %s', (phase, status, expected) => {
    expect(projectDexieSyncState({ phase, status } as State).status).toBe(expected);
  });
  it('retains explicit failures', () => {
    expect(projectDexieSyncState({
      phase: 'pushing', status: 'error', error: new Error('SERVER_REJECTED'),
    } as State)).toEqual({ status: 'error', error: 'SERVER_REJECTED' });
  });
  it('requires an entity receipt before green', () => {
    expect(itemSyncStatus(false, false, 'synced')).toBe('local');
    expect(itemSyncStatus(false, false, 'syncing')).toBe('syncing');
    expect(itemSyncStatus(false, false, 'error')).toBe('error');
    expect(itemSyncStatus(true, false, 'local')).toBe('synced');
    expect(itemSyncStatus(true, false, 'error')).toBe('synced');
    expect(itemSyncStatus(true, true, 'synced')).toBe('error');
  });
  it('exposes exactly the four approved labels and colors', () => {
    expect((['local', 'syncing', 'synced', 'error'] as const).map(v=>[syncStatusLabel(v),syncStatusColor(v)]))
      .toEqual([['Локально','gray'],['Синхронизация','yellow'],['Синхронизировано','green'],['Ошибка','red']]);
  });
});
