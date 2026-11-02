import Dexie from 'dexie';
import type { MezfitCloudDatabase } from './database';
import { isApprovedAssignedPair } from './relationship-access';

/** Only Worker-confirmed two-member relationships may receive profile defaults. */
export function profileRelationships(
  db: Pick<MezfitCloudDatabase, 'realms' | 'members'>, actorUserId: string,
) {
  // Keep discovery, native crypto and its continuations in one transaction lifetime.
  return Dexie.waitFor((async () => {
  const [realms, members] = await Promise.all([db.realms.toArray(), db.members.toArray()]);
  const pairs: Array<{ realmId: string; coachUserId: string; clientUserId: string }> = [];
  for (const realm of realms) {
    const own = members.find(member => member.realmId === realm.realmId && member.userId === actorUserId);
    const peer = members.find(member => member.realmId === realm.realmId && member.userId !== actorUserId);
    if (!own?.userId || !peer?.userId) continue;
    const coachUserId = own.roles?.includes('coach') ? own.userId : peer.userId;
    const clientUserId = own.roles?.includes('coach') ? peer.userId : own.userId;
    if (await isApprovedAssignedPair(realm, members, coachUserId, clientUserId))
      pairs.push({ realmId: realm.realmId, coachUserId, clientUserId });
  }
  return pairs.sort((a, b) => a.realmId.localeCompare(b.realmId));
  })());
}
