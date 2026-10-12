import { liveQuery } from 'dexie';
import { createCloudDatabase, type CloudTrainingPlanRow } from './database';

interface RelationshipMember {
  realmId: string;
  userId?: string;
  roles?: string[];
}

/** A matching user ID in a private realm is not proof of an assignment. */
export function isApprovedAssignedPair(
  realmOwner: unknown,
  members: readonly RelationshipMember[],
  realmId: string,
  coachUserId: string,
  clientUserId: string,
): boolean {
  return realmOwner === null
    && coachUserId !== clientUserId
    && members.some((member) => member.realmId === realmId
      && member.userId === coachUserId && member.roles?.includes('coach'))
    && members.some((member) => member.realmId === realmId
      && member.userId === clientUserId && member.roles?.includes('client'));
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

  constructor(telegramUserId: string, initData: string) {
    this.actorUserId = `tg:${telegramUserId}`;
    this.db = createCloudDatabase(telegramUserId, initData);
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
      const ownerByRealm = new Map(realms.map((realm) => [realm.realmId, realm.owner]));
      // Membership and realm ownership, not client-supplied coach/client IDs,
      // determine whether this is a genuine shared assigned PLAN.
      return sortAssignedPlans(plans.filter((plan) => isApprovedAssignedPair(
        ownerByRealm.get(plan.realmId), members, plan.realmId, plan.coachUserId, plan.clientUserId,
      )));
    }).subscribe({
      next: onChange,
      error: onError,
    });
  }

  /** Membership is read from the authenticated user's synced cloud subset.
   * Supplied client IDs are selectors, never authorization proof. */
  private async relationshipRealm(clientTelegramId: string): Promise<string> {
    if (!/^[1-9]\d*$/.test(clientTelegramId)) throw new Error('Некорректный клиент');
    const clientUserId = `tg:${clientTelegramId}`;
    if (clientUserId === this.actorUserId) throw new Error('Нельзя назначить программу самому себе');

    const [coaches, clients] = await Promise.all([
      this.db.members.where('userId').equals(this.actorUserId).toArray(),
      this.db.members.where('userId').equals(clientUserId).toArray(),
    ]);
    const members = [...coaches, ...clients];
    for (const member of clients) {
      const realm = await this.db.realms.get(member.realmId);
      if (isApprovedAssignedPair(
        realm?.owner, members, member.realmId, this.actorUserId, clientUserId,
      )) return member.realmId;
    }
    throw new Error('Связь с клиентом ещё не синхронизирована. Подключитесь к сети и повторите.');
  }

  async createAssigned(clientTelegramId: string, rawName: string): Promise<string> {
    const name = rawName.trim();
    if (!name || name.length > 120) throw new Error('Название программы должно содержать от 1 до 120 символов');
    const realmId = await this.relationshipRealm(clientTelegramId);
    const now = new Date().toISOString();
    const position = await this.db.trainingPlans.where('realmId').equals(realmId).count();
    // @id generates a globally unique key. Explicit owner:null prevents
    // creator ownership from overriding the coach/client PLAN permission split.
    return this.db.trainingPlans.add({
      realmId,
      owner: null,
      coachUserId: this.actorUserId,
      clientUserId: `tg:${clientTelegramId}`,
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
    await this.db.cloud.sync({ purpose: 'pull' });
  }

  close(): void {
    this.db.close();
  }
}
