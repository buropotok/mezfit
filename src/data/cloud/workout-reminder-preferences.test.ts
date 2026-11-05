import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { CLOUD_DATABASE_STORES_V13 } from './database';
import type { FlexAttributeRow, FlexValueRow } from './flex-attributes';
import { WorkoutReminderPreferencesRepository } from './workout-reminder-preferences';

class ReminderTestDatabase extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  adHocSessions!: Table<unknown, string>;

  constructor() {
    super('workout-reminder-preferences-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: CLOUD_DATABASE_STORES_V13.flexAttributes,
      flexValues: CLOUD_DATABASE_STORES_V13.flexValues,
      adHocSessions: CLOUD_DATABASE_STORES_V13.adHocSessions.replaceAll('@', ''),
    });
  }
}

const databases: ReminderTestDatabase[] = [];
function create() {
  const db = new ReminderTestDatabase();
  databases.push(db);
  return db;
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe('workout reminder personal preferences', () => {
  it('starts with all reminders enabled and persists the three independent settings', async () => {
    const db = create();
    const repo = new WorkoutReminderPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:11');
    expect(await repo.read()).toEqual({ client: true, coached: true, own: true });

    await repo.set('client', false);
    await repo.set('coached', false);
    expect(await repo.read()).toEqual({ client: false, coached: false, own: true });

    await repo.set('own', false);
    await repo.set('client', true);
    expect(await repo.read()).toEqual({ client: true, coached: false, own: false });
    expect(await db.flexAttributes.count()).toBe(3);
    expect(await db.flexValues.count()).toBe(3);
    expect((await db.flexValues.toArray()).every(row =>
      row.realmId === 'tg:11' && row.owner === 'tg:11'
      && row.entityType === 'user' && row.entityId === 'tg:11')).toBe(true);
  });

  it('does not allow another actor to change a private preference', async () => {
    const db = create();
    const repo = new WorkoutReminderPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:11');
    await repo.set('own', false);
    const other = new WorkoutReminderPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:12');
    expect(await other.read()).toEqual({ client: true, coached: true, own: true });
    expect(await repo.read()).toEqual({ client: true, coached: true, own: false });
  });
});
