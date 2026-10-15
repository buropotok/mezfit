import { describe, expect, it } from 'vitest';
import { projectCloudSyncState } from './CloudConnectionsProvider';

describe('Dexie Cloud background sync projection', () => {
  it('does not confuse cached contacts with confirmed server sync', () => {
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'connected' }))
      .toEqual({ status: 'synced', error: '' });
    expect(projectCloudSyncState({ phase: 'pulling', status: 'connected' }).status)
      .toBe('pending');
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'disconnected' }).status)
      .toBe('pending');
  });

  it('surfaces offline and rejected pushes independently of contact hydration', () => {
    expect(projectCloudSyncState({ phase: 'in-sync', status: 'offline' }).status)
      .toBe('offline');
    expect(projectCloudSyncState({
      phase: 'error', status: 'connected', error: new Error('PLAN_REJECTED'),
    })).toEqual({ status: 'error', error: 'PLAN_REJECTED' });
  });
});
