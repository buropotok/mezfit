import Dexie, { liveQuery } from 'dexie';
import { relationshipRealmId, stableCloudRelationshipId } from '../../../shared/relationship-id';
import { createCloudDatabase, type CloudTrainingPlanRow, type MezfitCloudDatabase } from './database';

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

function telegramId(userId: string): string | null {
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

/** Fail closed on extra/unaccepted/owned members or any non-Worker realm. */
export async function isApprovedAssignedPair(
  realm: RelationshipRealm | undefined,
  members: readonly RelationshipMember[],
  coachUserId: string,
  clientUserId: string,
): Promise<boolean> {
  const coach = telegramId(coachUserId);
  const client = telegramId(clientUserId);
  if (!coach || !client || coach === client || !realm) return false;
  // WebCrypto is external to Dexie. Preserve the liveQuery observation context
  // so table reads after this authorization check still subscribe to changes.
  const expectedRealmId = await Dexie.waitFor(relationshipRealmId(coach, client));
  if (realm.realmId !== expectedRealmId || realm.owner !== null
    || realm.name !== 'Mezfit coach-client pilot') return false;

  const pairMembers = members.filter((member) => member.realmId === expectedRealmId);
  if (pairMembers.length !== 2) return false;
  const [coachMemberId, clientMemberId] = await Dexie.waitFor(Promise.all([
    stableCloudRelationshipId('mmb', expectedRealmId + ':coach'),
    stableCloudRelationshipId('mmb', expectedRealmId + ':client'),
  ]));
  return pairMembers.some((member) => approvedMember(member, coachMemberId, coachUserId, 'coach'))
    && pairMembers.some((member) => approvedMember(member, clientMemberId, clientUserId, 'client'));
}

/** Canonical order is persisted; generated cloud IDs are only tie-breakers. */
export function sortAssignedPlans<T extends Pick<CloudTrainingPlanRow, 'position' | 'id'>>(plans: readonly T[]): T[] {
  return [...plans].sort((left, right) =>
    left.position - right.position || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** The only persistence owner for newly assigned PLAN headers. */
export class AssignedProgramsRepository {
  private readonly db;
  readonly actorUserId: string;

  constructor(telegramUserId: string, initData: string, private readonly sharedDb?: MezfitCloudDatabase) {
    this.actorUserId = `tg:${telegramUserId}`;
    this.db = sharedDb ?? createCloudDatabase(telegramUserId, initData);
  }

  observe(
    onChange: (rows: CloudTrainingPlanRow[]) => void,
    onError: (error: unknown) => void,
  ): { unsubscribe(): void } {
    return liveQuery(async () => {
      const [plans, realms, members] = await Promise.all([
        this.db.trainingPlans.toArray(),
        this.db.realms.toArray(),
        this.db.members.toArray(),
      ]);
      const realmById = new Map(realms.map((realm) => [realm.realmId, realm]));
      const permitted = await Promise.all(plans.map(async (plan) => {
        if (plan.deletedAt) return null;
        if (plan.realmId === this.actorUserId && plan.athleteUserId === this.actorUserId
          && plan.coachUserId === null && plan.clientUserId === null) return plan;
        if (!plan.coachUserId || !plan.clientUserId) return null;
        return await isApprovedAssignedPair(
          realmById.get(plan.realmId), members, plan.coachUserId, plan.clientUserId,
        ) ? plan : null;
      }));
      return sortAssignedPlans(permitted.filter((plan): plan is CloudTrainingPlanRow => plan !== null));
    }).subscribe({
      next: onChange,
      error: onError,
    });
  }

  /** The Worker-provisioned canonical realm and exactly two accepted members
   * are required; user IDs supplied by UI remain selectors, not proof. */
  private async relationshipRealm(clientTelegramId: string): Promise<string> {
    const clientUserId = `tg:${clientTelegramId}`;
    if (!telegramId(clientUserId)) throw new Error('Некорректный клиент');
    if (clientUserId === this.actorUserId) throw new Error('Нельзя назначить программу самому себе');

    const realmId = await relationshipRealmId(this.actorUserId.slice(3), clientTelegramId);
    const [realm, members] = await Promise.all([
      this.db.realms.get(realmId),
      this.db.members.where('realmId').equals(realmId).toArray(),
    ]);
    if (await isApprovedAssignedPair(realm, members, this.actorUserId, clientUserId)) return realmId;
    throw new Error('Связь с клиентом ещё не синхронизирована. Подключитесь к сети и повторите.');
  }

  async createAssigned(clientTelegramId: string, rawName: string): Promise<string> {
    const name = rawName.trim();
    if (!name || name.length > 120) throw new Error('Название программы должно содержать от 1 до 120 символов');
    const realmId = await this.relationshipRealm(clientTelegramId);
    const now = new Date().toISOString();
    const position = await this.db.trainingPlans.where('realmId').equals(realmId).count();
    // Maintain the ownerless input contract of this pilot adapter. The
    // installed Addon may implicitly assign ownership to the authorized
    // Coach creator; domain readers accept either exact representation.
    return this.db.trainingPlans.add({
      realmId,
      owner: null,
      coachUserId: this.actorUserId,
      clientUserId: `tg:${clientTelegramId}`,
      athleteUserId: `tg:${clientTelegramId}`,
      name,
      position,
      status: 'draft',
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async refresh(): Promise<void> {
    await this.db.cloud.sync({ purpose: 'pull', wait: true });
  }

  close(): void {
    if (!this.sharedDb) this.db.close();
  }
}
