import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdHocSessionRow } from './adhoc-workout-types';
import { CLOUD_DATABASE_STORES_V13 } from './database';
import {
  FlexAttributesRepository, flexAttributeId, flexValueId, isValidFlexValue,
  type FlexAttributeRow, type FlexValueRow, type FlexEntityTarget,
} from './flex-attributes';

class TestFlexDatabase extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  adHocSessions!: Table<AdHocSessionRow, string>;

  constructor() {
    super('flex-attributes-test-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: CLOUD_DATABASE_STORES_V13.flexAttributes,
      flexValues: CLOUD_DATABASE_STORES_V13.flexValues,
      adHocSessions: CLOUD_DATABASE_STORES_V13.adHocSessions,
    });
  }
}

const databases: TestFlexDatabase[] = [];
const create = () => {
  const db = new TestFlexDatabase();
  databases.push(db);
  return db;
};
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

const personal: FlexEntityTarget = { entityType: 'user', entityId: 'tg:1', realmId: 'tg:1' };
const shared: FlexEntityTarget = { entityType: 'adHocSession', entityId: 'session-1', realmId: 'relationship-1' };
const moment = '2026-10-29T00:00:00.000Z';

async function addSharedSession(db: TestFlexDatabase) {
  await db.adHocSessions.add({
    id: shared.entityId, realmId: shared.realmId, owner: shared.realmId,
    athleteUserId: 'tg:1', coachUserId: 'tg:2', clientUserId: 'tg:1', creatorUserId: 'tg:2',
    name: 'Workout', comment: null, programName: null, autoCreatedProgram: false,
    startedAt: moment, completedAt: null, status: 'active', createdAt: moment, updatedAt: moment,
  });
}

describe('FlexAttributesRepository', () => {
  it('registers a key and upserts one value with stable IDs without duplicates', async () => {
    const db = create();
    const repo = new FlexAttributesRepository(db, 'tg:1');
    const input = { key: 'Band_1_min', valueType: 'number' as const, value: 2 };
    await repo.setValue(personal, input);
    await repo.setValue(personal, { ...input, value: 6 });
    expect(await db.flexAttributes.count()).toBe(1);
    expect(await db.flexValues.count()).toBe(1);
    expect(await db.flexValues.get(flexValueId(personal, flexAttributeId('tg:1', 'Band_1_min'))))
      .toMatchObject({ value: 6, realmId: 'tg:1', owner: 'tg:1' });
    expect(await repo.getValues(personal)).toEqual([{ key: 'Band_1_min', valueType: 'number', value: 6 }]);
    await repo.clearValue(personal, 'Band_1_min', 'number');
    expect(await repo.getValues(personal)).toEqual([{ key: 'Band_1_min', valueType: 'number', value: null }]);
  });

  it('stores shared snapshots in the session realm and permits only its participants', async () => {
    const db = create();
    await addSharedSession(db);
    const coach = new FlexAttributesRepository(db, 'tg:2');
    await coach.setValue(shared, { key: 'Band_1_color', valueType: 'string', value: '#0099FF' });
    expect(await db.flexValues.toArray()).toMatchObject([{ owner: 'relationship-1', realmId: 'relationship-1',
      entityType: 'adHocSession', entityId: 'session-1', value: '#0099FF' }]);
    expect(await new FlexAttributesRepository(db, 'tg:1').getValues(shared))
      .toEqual([{ key: 'Band_1_color', valueType: 'string', value: '#0099FF' }]);
    await expect(new FlexAttributesRepository(db, 'tg:3').getValues(shared)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(coach.setValue({ ...shared, realmId: 'relationship-other' },
      { key: 'Bad', valueType: 'boolean', value: true })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
  });

  it('rejects foreign personal values, missing sessions and unsupported types', async () => {
    const db = create();
    const repo = new FlexAttributesRepository(db, 'tg:1');
    await expect(repo.setValue({ ...personal, entityId: 'tg:2' },
      { key: 'Band_1_min', valueType: 'number', value: 2 })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(repo.getValues(shared)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(repo.setValue(personal,
      { key: 'Band_1_min', valueType: 'number', value: Number.NaN })).rejects.toThrow('INVALID_FLEX_ATTRIBUTE_VALUE');
    await expect(repo.setValue(personal,
      { key: 'Band_1_min', valueType: 'number', value: 'bad' })).rejects.toThrow('INVALID_FLEX_ATTRIBUTE_VALUE');
    await expect(repo.setValue(personal,
      { key: 'bad-key', valueType: 'boolean', value: true })).rejects.toThrow('INVALID_FLEX_ATTRIBUTE_VALUE');
    expect(await db.flexValues.count()).toBe(0);
    expect(isValidFlexValue('number', Infinity)).toBe(false);
    expect(isValidFlexValue('string', 'x'.repeat(1025))).toBe(false);
  });

  it('keeps batched updates atomic and refuses changes to registered value types', async () => {
    const db = create();
    const repo = new FlexAttributesRepository(db, 'tg:1');
    await repo.setValues(personal, [
      { key: 'Band_1_min', valueType: 'number', value: 2 },
      { key: 'Band_1_max', valueType: 'number', value: 5 },
    ]);
    await expect(repo.setValues(personal, [
      { key: 'Band_1_min', valueType: 'number', value: 9 },
      { key: 'Band_1_max', valueType: 'string', value: 'wrong' },
    ])).rejects.toThrow('FLEX_ATTRIBUTE_CONFLICT');
    expect(await repo.getValues(personal)).toEqual([
      { key: 'Band_1_min', valueType: 'number', value: 2 },
      { key: 'Band_1_max', valueType: 'number', value: 5 },
    ]);
    await expect(repo.setValues(personal, [
      { key: 'Band_1_min', valueType: 'number', value: 3 },
      { key: 'Band_1_min', valueType: 'number', value: 4 },
    ])).rejects.toThrow('DUPLICATE_FLEX_ATTRIBUTE');
  });

  it('isolates the same attribute key between personal and session realms', async () => {
    const db = create();
    await addSharedSession(db);
    const repo = new FlexAttributesRepository(db, 'tg:1');
    await repo.setValue(personal, { key: 'Band_1_min', valueType: 'number', value: 6 });
    await repo.setValue(shared, { key: 'Band_1_min', valueType: 'number', value: 2 });
    expect(await db.flexAttributes.count()).toBe(2);
    expect(await repo.getValues(personal)).toMatchObject([{ value: 6 }]);
    expect(await repo.getValues(shared)).toMatchObject([{ value: 2 }]);
  });
});
