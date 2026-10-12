import { liveQuery } from 'dexie';
import { createCloudDatabase, type CloudTrainingPlanRow } from './database';

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
    return liveQuery(() => this.db.trainingPlans.toArray()).subscribe({
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
    const coachRealms = new Set(coaches.filter((member) =>
      member.roles?.includes('coach')).map((member) => member.realmId));
    for (const member of clients) {
      if (!member.roles?.includes('client') || !coachRealms.has(member.realmId)) continue;
      const realm = await this.db.realms.get(member.realmId);
      if (realm?.owner === null) return realm.realmId;
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
