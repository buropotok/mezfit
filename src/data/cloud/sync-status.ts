import type { MezfitCloudDatabase } from './database';

/** Product sync indicators use only the Dexie Addon PHASE.
 * Real devices can report phase "in-sync" alongside transport status "offline".
 * Never infer a per-record delivery receipt from this global phase.
 */
export type CloudSyncStatus = 'local' | 'syncing' | 'synced' | 'error';
type AddonSyncState = MezfitCloudDatabase['cloud']['syncState']['value'];

export function projectDexieSyncState(state: AddonSyncState): { status: CloudSyncStatus; error: string } {
  if (state.phase === 'error' || state.status === 'error') {
    return { status: 'error', error: state.error?.message || 'Синхронизация с Mezfit облаком завершилась ошибкой.' };
  }
  if (state.phase === 'pushing' || state.phase === 'pulling') return { status: 'syncing', error: '' };
  if (state.phase === 'in-sync') return { status: 'synced', error: '' };
  // Initial, not-in-sync and idle/offline phases do not prove cloud delivery.
  // Ignore the separate transport status "offline" completely.
  return { status: 'local', error: '' };
}

/** A green per-entity indicator requires that entity's own awaited push receipt. */
export function itemSyncStatus(confirmed: boolean, failed: boolean, global: CloudSyncStatus): CloudSyncStatus {
  if (failed) return 'error';
  if (confirmed) return 'synced';
  if (global === 'error') return 'error';
  return global === 'syncing' ? 'syncing' : 'local';
}

export function syncStatusLabel(status: CloudSyncStatus): string {
  switch (status) {
    case 'local': return 'Локально';
    case 'syncing': return 'Синхронизация';
    case 'synced': return 'Синхронизировано';
    case 'error': return 'Ошибка';
  }
}
export function syncStatusColor(status: CloudSyncStatus): 'gray' | 'yellow' | 'green' | 'red' {
  switch (status) {
    case 'local': return 'gray';
    case 'syncing': return 'yellow';
    case 'synced': return 'green';
    case 'error': return 'red';
  }
}
