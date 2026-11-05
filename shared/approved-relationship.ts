import { relationshipRealmId, stableCloudRelationshipId } from './relationship-id';

export interface RelationshipRealmView {
  realmId: string;
  owner?: unknown;
  name?: string;
}

export interface RelationshipMemberView {
  id: string;
  realmId: string;
  userId?: string;
  owner?: unknown;
  roles?: string[];
  accepted?: Date | boolean;
  invite?: boolean;
  permissions?: unknown;
}

export interface AssignedPairCheck {
  realm: RelationshipRealmView | undefined;
  members: readonly RelationshipMemberView[];
  coachUserId: string;
  clientUserId: string;
}

export function validatedTelegramId(userId: string): string | null {
  if (!userId.startsWith('tg:')) return null;
  const id = userId.slice(3);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    && String(Number(id)) === id ? id : null;
}

function acceptedMembership(value: RelationshipMemberView['accepted']): boolean {
  return value === true || (value instanceof Date && Number.isFinite(value.getTime()));
}

function approvedMember(member: RelationshipMemberView, id: string, userId: string, role: 'coach' | 'client'): boolean {
  return member.id === id && member.userId === userId && member.owner === null
    && member.roles?.length === 1 && member.roles[0] === role && member.invite !== true
    && acceptedMembership(member.accepted)
    && (member.permissions == null
      || (typeof member.permissions === 'object' && !Array.isArray(member.permissions)
        && Object.keys(member.permissions).length === 0));
}

/** Identical realm authorization for local UI projections and privileged reminder delivery. */
export async function checkApprovedAssignedPair({ realm, members, coachUserId, clientUserId }: AssignedPairCheck): Promise<boolean> {
  const coach = validatedTelegramId(coachUserId);
  const client = validatedTelegramId(clientUserId);
  if (!coach || !client || coach === client || !realm) return false;
  const expectedRealmId = await relationshipRealmId(coach, client);
  if (realm.realmId !== expectedRealmId || realm.owner !== null
    || realm.name !== 'Mezfit coach-client pilot') return false;

  const pairMembers = members.filter(member => member.realmId === expectedRealmId);
  if (pairMembers.length !== 2) return false;
  const [coachMemberId, clientMemberId] = await Promise.all([
    stableCloudRelationshipId('mmb', expectedRealmId + ':coach'),
    stableCloudRelationshipId('mmb', expectedRealmId + ':client'),
  ]);
  return pairMembers.some(member => approvedMember(member, coachMemberId, coachUserId, 'coach'))
    && pairMembers.some(member => approvedMember(member, clientMemberId, clientUserId, 'client'));
}
