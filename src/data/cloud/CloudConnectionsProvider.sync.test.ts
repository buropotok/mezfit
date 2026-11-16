import { describe, expect, it } from 'vitest';
import { projectCloudSyncState } from './CloudConnectionsProvider';

describe('Dexie Cloud background sync projection', () => {
  it('does not confuse cached contacts with confirmed server sync', () => {
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'connected' }))
      .toEqual({ status: 'synced', error: '' });
    expect(projectCloudSyncState({ phase: 'pulling', status: 'connected' }).status)
      .toBe('syncing');
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'disconnected' }).status)
      .toBe('synced');
  });

  it('ignores transport offline while surfacing explicit rejected pushes', () => {
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'offline' }).status)
      .toBe('synced');
    expect(projectCloudSyncState({
      phase: 'error', status: 'connected', error: new Error('PLAN_REJECTED'),
    })).toEqual({ status: 'error', error: 'PLAN_REJECTED' });
  });
});
