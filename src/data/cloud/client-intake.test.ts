import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import type { FlexAttributeRow, FlexValueRow } from './flex-attributes';
import {
  ClientIntakeRepository, ageFromBirthDate, initialClientIntake, validateClientIntake,
} from './client-intake';

class IntakeDb extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  constructor() {
    super('client-intake-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: 'id, realmId, [realmId+key]',
      flexValues: 'id, realmId, attributeId, [realmId+attributeId], [realmId+entityType+entityId]',
      adHocSessions: 'id', realms: 'realmId', members: 'id, realmId, userId',
    });
  }
}
const databases: IntakeDb[] = [];
const create = () => {
  const db = new IntakeDb();
  databases.push(db);
  return { db, repo: new ClientIntakeRepository(db as unknown as MezfitCloudDatabase, 'tg:202') };
};
const draft = {
  firstName: 'Ольга', lastName: 'Петрова', email: 'test@example.com', phone: '+79991234567',
  telegramUsername: 'olga_fit', birthDate: '1999-10-28',
  sex: 'female' as const, weightKg: 62,
};
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

describe('client onboarding domain', () => {
  it('prefills verified Telegram fields without inventing birth date or contacts', () => {
    expect(initialClientIntake({ firstName: 'Ольга', lastName: 'Петрова', telegramUsername: '@olga_fit' }))
      .toMatchObject({ firstName: 'Ольга', lastName: 'Петрова',
        telegramUsername: 'olga_fit', birthDate: '', email: '', phone: '', weightKg: null });
    expect(ageFromBirthDate('2000-12-31', '2026-11-01')).toBe(25);
    expect(ageFromBirthDate('2000-11-01', '2026-11-01')).toBe(26);
    expect(validateClientIntake(draft, '2026-11-01')).toBeNull();
    expect(validateClientIntake({ ...draft, birthDate: '2027-01-01' }, '2026-11-01'))
      .toContain('дату рождения');
    expect(validateClientIntake({ ...draft, email: 'invalid' }, '2026-11-01')).toContain('E-mail');
  });

  it('stores an updatable personal profile in private realm and does not duplicate keys', async () => {
    const { db, repo } = create();
    await repo.saveOwn(draft);
    expect(await repo.readOwn()).toMatchObject(draft);
    await repo.saveOwn({ ...draft, weightKg: 63 });
    expect(await repo.readOwn()).toMatchObject({ weightKg: 63, firstName: 'Ольга' });
    expect(await db.flexValues.count()).toBe(9);
    const rows = await db.flexValues.toArray();
    expect(rows.every(row => row.owner === 'tg:202' && row.realmId === 'tg:202')).toBe(true);
  });

  it('shares only to a verified coach relationship and permits coach read-only projection', async () => {
    const { db, repo } = create();
    const approved = await relationshipMembership('101', '202');
    await db.table('realms').add(approved.realm);
    await db.table('members').bulkAdd(approved.members);
    const saved = await repo.saveOwn(draft);
    await repo.shareWithCoach(saved, { relationshipId: approved.realm.realmId, coachUserId: 'tg:101' });
    const coach = new ClientIntakeRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
    expect(await coach.readForCoach(approved.realm.realmId, 'tg:202')).toMatchObject(draft);
    const before = await db.flexValues.count();
    await repo.shareWithCoach(saved, { relationshipId: approved.realm.realmId, coachUserId: 'tg:101' });
    expect(await db.flexValues.count()).toBe(before);
    await expect(coach.readForCoach(approved.realm.realmId, 'tg:303'))
      .rejects.toThrow('CLIENT_INTAKE_FORBIDDEN');
    await expect(repo.shareWithCoach(saved, { relationshipId: approved.realm.realmId, coachUserId: 'tg:303' }))
      .rejects.toThrow('CLIENT_INTAKE_FORBIDDEN');
    await db.table('members').where('realmId').equals(approved.realm.realmId).delete();
    await expect(coach.readForCoach(approved.realm.realmId, 'tg:202'))
      .rejects.toThrow('CLIENT_INTAKE_FORBIDDEN');
  });

  it('rejects malformed contact data without persisting the completed marker', async () => {
    const { db, repo } = create();
    await expect(repo.saveOwn({ ...draft, phone: 'abc' })).rejects.toContain('Проверьте номер');
    expect(await db.flexValues.count()).toBe(0);
  });
});
