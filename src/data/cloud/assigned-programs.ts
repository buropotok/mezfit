import { liveQuery } from 'dexie';
import { relationshipRealmId } from '../../../shared/relationship-id';
import { isApprovedAssignedPair } from './relationship-access';
export { isApprovedAssignedPair } from './relationship-access';
import { createCloudDatabase, type CloudTrainingPlanRow, type MezfitCloudDatabase } from './database';

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
