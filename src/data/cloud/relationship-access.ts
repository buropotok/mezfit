import Dexie from 'dexie';
import { relationshipRealmId, stableCloudRelationshipId } from '../../../shared/relationship-id';

interface RelationshipRealm {
  realmId: string;
  owner?: unknown;
  name?: string;
}

interface RelationshipMember {
  id: string;
  realmId: string;
  userId?: string;
  owner?: unknown;
  roles?: string[];
  // The privileged Worker writes accepted:true. Some Dexie Cloud rows retain
  // this accepted marker as a boolean; SDK-created invitations use a Date.
  accepted?: Date | boolean;
  invite?: boolean;
  permissions?: unknown;
}

export function telegramId(userId: string): string | null {
  if (!userId.startsWith('tg:')) return null;
  const id = userId.slice(3);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    && String(Number(id)) === id ? id : null;
}

function isAcceptedMembership(value: RelationshipMember['accepted']): boolean {
  // Only the explicitly accepted boolean or a valid acceptance timestamp is valid.
  // Never admit false, undefined or an arbitrary truthy/untrusted string.
  return value === true || (value instanceof Date && Number.isFinite(value.getTime()));
}

function approvedMember(member: RelationshipMember, id: string, userId: string, role: 'coach' | 'client'): boolean {
  return member.id === id && member.userId === userId && member.owner === null
    && member.roles?.length === 1 && member.roles[0] === role && member.invite !== true
    && isAcceptedMembership(member.accepted)
    && (member.permissions == null
      || (typeof member.permissions === 'object' && !Array.isArray(member.permissions)
        && Object.keys(member.permissions).length === 0));
}

interface AssignedPairCheck {
  realm: RelationshipRealm | undefined;
  members: readonly RelationshipMember[];
  coachUserId: string;
  clientUserId: string;
}

/** Validation promise without its own keepalive; the caller owns the waitFor scope. */
async function checkApprovedPair({ realm, members, coachUserId, clientUserId }: AssignedPairCheck): Promise<boolean> {
  const coach = telegramId(coachUserId);
  const client = telegramId(clientUserId);
  if (!coach || !client || coach === client || !realm) return false;
  const expectedRealmId = await relationshipRealmId(coach, client);
  if (realm.realmId !== expectedRealmId || realm.owner !== null
    || realm.name !== 'Mezfit coach-client pilot') return false;

  const pairMembers = members.filter((member) => member.realmId === expectedRealmId);
  if (pairMembers.length !== 2) return false;
  const [coachMemberId, clientMemberId] = await Promise.all([
    stableCloudRelationshipId('mmb', expectedRealmId + ':coach'),
    stableCloudRelationshipId('mmb', expectedRealmId + ':client'),
  ]);
  return pairMembers.some((member) => approvedMember(member, coachMemberId, coachUserId, 'coach'))
    && pairMembers.some((member) => approvedMember(member, clientMemberId, clientUserId, 'client'));
}

/** Fail closed on extra/unaccepted/owned members or any non-Worker realm. */
export function isApprovedAssignedPair(
  realm: RelationshipRealm | undefined,
  members: readonly RelationshipMember[],
  coachUserId: string,
  clientUserId: string,
): Promise<boolean> {
  const coach = telegramId(coachUserId), client = telegramId(clientUserId);
  if (!coach || !client || coach === client || !realm) return Dexie.Promise.resolve(false);
  return Dexie.waitFor(checkApprovedPair({ realm, members, coachUserId, clientUserId }));
}

/** Validate multiple relationships with one waitFor, not overlapping keepalive loops.
 * Within a Dexie transaction, parallel waitFor calls can starve IndexedDB progress. */
export function approvedAssignedPairs(checks: readonly AssignedPairCheck[]): Promise<boolean[]> {
  if (!checks.length) return Dexie.Promise.resolve([]);
  return Dexie.waitFor(Promise.all(checks.map(checkApprovedPair)));
}

