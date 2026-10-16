import { describe, expect, it } from 'vitest';
import { globalCoachPhasePermission } from './cloudPhasePermissions';

describe('synced global coach phase policy', () => {
  const role = (manage: string[]) => ({ realmId: 'rlm-public', name: 'coach', permissions: { manage } });
  it('distinguishes old, deployed and unread policies without inferring connectivity', () => {
    expect(globalCoachPhasePermission([])).toBeNull();
    expect(globalCoachPhasePermission([role(['trainingPlans'])])).toBe(false);
    expect(globalCoachPhasePermission([role(['trainingPlans', 'programPhases'])])).toBe(true);
    expect(globalCoachPhasePermission([{ ...role(['programPhases']), realmId: 'private' }])).toBeNull();
    expect(globalCoachPhasePermission([null, {}, { name: 'coach' }])).toBeNull();
  });
});
