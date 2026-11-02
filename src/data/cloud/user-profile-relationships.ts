import Dexie from 'dexie';
import type { MezfitCloudDatabase } from './database';
import { isApprovedAssignedPair } from './relationship-access';

interface ProfileRelationship {
  realmId: string;
  coachUserId: string;
  clientUserId: string;
}

/** Only Worker-confirmed two-member relationships may receive profile defaults. */
export function profileRelationships(
  db: Pick<MezfitCloudDatabase, 'realms' | 'members'>, actorUserId: string,
): Promise<ProfileRelationship[]> {
  // Database reads stay in the transaction; only the validator's WebCrypto
  // computation uses waitFor. Wrapping both creates a nested wait dependency.
  return Dexie.Promise.all([db.realms.toArray(), db.members.toArray()]).then(([realms, members]) => {
    const checks: Array<Promise<ProfileRelationship | null>> = [];
    for (const realm of realms) {
      const own = members.find(member => member.realmId === realm.realmId && member.userId === actorUserId);
      const peer = members.find(member => member.realmId === realm.realmId && member.userId !== actorUserId);
      if (!own?.userId || !peer?.userId) continue;
      const coachUserId = own.roles?.includes('coach') ? own.userId : peer.userId;
      const clientUserId = own.roles?.includes('coach') ? peer.userId : own.userId;
      const pair = { realmId: realm.realmId, coachUserId, clientUserId };
      checks.push(isApprovedAssignedPair(realm, members, coachUserId, clientUserId)
        .then(approved => approved ? pair : null));
    }
    return Dexie.Promise.all(checks).then(pairs => pairs
      .filter(pair => pair !== null)
      .sort((a, b) => a.realmId.localeCompare(b.realmId)));
  });
}
