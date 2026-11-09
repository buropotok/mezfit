import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { MezfitCloudDatabase } from './database';
import { CLOUD_DATABASE_STORES_V13 } from './database';
import type { FlexAttributeRow, FlexValueRow } from './flex-attributes';
import { WeightRepsPickerPreferencesRepository, WEIGHT_REPS_PICKER_MODE_KEY } from './weight-reps-picker-preferences';

class PickerPreferencesDatabase extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  adHocSessions!: Table<unknown, string>;

  constructor() {
    super('weight-reps-picker-preferences-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: CLOUD_DATABASE_STORES_V13.flexAttributes,
      flexValues: CLOUD_DATABASE_STORES_V13.flexValues,
      adHocSessions: CLOUD_DATABASE_STORES_V13.adHocSessions.replaceAll('@', ''),
    });
  }
}

const databases: PickerPreferencesDatabase[] = [];
function create() {
  const db = new PickerPreferencesDatabase();
  databases.push(db);
  return db;
}

afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe('weight/reps picker personal mode', () => {
  it('defaults to numbers, stores wheels in the actor personal realm, and resets to numbers', async () => {
    const db = create();
    const repo = new WeightRepsPickerPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:11');
    expect(await repo.read()).toBe('numbers');

    await repo.set('wheels');
    expect(await repo.read()).toBe('wheels');
    expect(await db.flexAttributes.toArray()).toEqual([
      expect.objectContaining({ key: WEIGHT_REPS_PICKER_MODE_KEY, realmId: 'tg:11', owner: 'tg:11', valueType: 'string' }),
    ]);
    expect(await db.flexValues.toArray()).toEqual([
      expect.objectContaining({ realmId: 'tg:11', owner: 'tg:11', entityType: 'user', entityId: 'tg:11', value: 'wheels' }),
    ]);

    await repo.set('numbers');
    expect(await repo.read()).toBe('numbers');
    expect((await db.flexValues.toArray())[0].value).toBeNull();
    expect(await db.flexValues.count()).toBe(1);
  });

  it('keeps one user preference isolated from another user and rejects unknown modes', async () => {
    const db = create();
    const first = new WeightRepsPickerPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:11');
    const second = new WeightRepsPickerPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:12');
    await first.set('wheels');
    expect(await second.read()).toBe('numbers');
    await second.set('wheels');
    await first.set('numbers');
    expect(await second.read()).toBe('wheels');
    expect(await first.read()).toBe('numbers');
    await expect(first.set('other' as 'wheels')).rejects.toThrow('INVALID_WEIGHT_REPS_PICKER_MODE');
  });

  it('falls back to the standard mode for a structurally valid but unknown stored string', async () => {
    const db = create();
    const repo = new WeightRepsPickerPreferencesRepository(db as unknown as MezfitCloudDatabase, 'tg:11');
    await repo.set('wheels');
    await db.flexValues.toCollection().modify({ value: 'obsolete' });
    expect(await repo.read()).toBe('numbers');
  });
});
