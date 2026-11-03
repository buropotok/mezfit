import Dexie from 'dexie';
import type { MezfitCloudDatabase } from './database';
import { approvedAssignedPairs } from './relationship-access';

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
    const candidates: Array<{ realm: typeof realms[number]; pair: ProfileRelationship }> = [];
    for (const realm of realms) {
      const own = members.find(member => member.realmId === realm.realmId && member.userId === actorUserId);
      const peer = members.find(member => member.realmId === realm.realmId && member.userId !== actorUserId);
      if (!own?.userId || !peer?.userId) continue;
      const coachUserId = own.roles?.includes('coach') ? own.userId : peer.userId;
      const clientUserId = own.roles?.includes('coach') ? peer.userId : own.userId;
      const pair = { realmId: realm.realmId, coachUserId, clientUserId };
      candidates.push({ realm, pair });
    }
    // A single WebCrypto keepalive protects the whole authorization batch.
    // Independent waitFor scopes per link can stall an IndexedDB transaction.
    return approvedAssignedPairs(candidates.map(({ realm, pair }) => ({ realm, members,
      coachUserId: pair.coachUserId, clientUserId: pair.clientUserId })))
      .then(approved => candidates.filter((_, index) => approved[index]).map(({ pair }) => pair)
        .sort((a, b) => a.realmId.localeCompare(b.realmId)));
  });
}
