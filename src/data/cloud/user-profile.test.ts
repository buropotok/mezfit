import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import { FlexAttributesRepository, flexAttributeId, type FlexAttributeRow, type FlexValueRow } from './flex-attributes';
import {
  UserProfileRepository, ageFromBirthDate, initialUserProfile, validateUserProfile,
} from './user-profile';

class ProfileDb extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  constructor() {
    super('user-profile-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: 'id, realmId, [realmId+key]',
      flexValues: 'id, realmId, attributeId, [realmId+attributeId], [realmId+entityType+entityId]',
      adHocSessions: 'id', realms: 'realmId', members: 'id, realmId, userId',
    });
  }
}
const databases: ProfileDb[] = [];
const create = () => {
  const db = new ProfileDb();
  databases.push(db);
  return { db, repo: new UserProfileRepository(db as unknown as MezfitCloudDatabase, 'tg:202') };
};
const draft = {
  firstName: 'Ольга', lastName: 'Петрова', email: 'test@example.com', phone: '+79991234567',
  birthDate: '1999-10-28',
  sex: 'female' as const, weightKg: 62,
};
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

describe('own user profile domain', () => {
  it('persists and reopens all optional fields empty while retaining the authenticated actor target', async () => {
    const { db, repo } = create();
    const empty = initialUserProfile({ firstName: '', lastName: '' });
    expect(validateUserProfile(empty)).toBeNull();
    expect(ageFromBirthDate('')).toBeNull();
    await repo.saveOwn(empty);
    db.close();
    await db.open();
    expect(await repo.readOwn()).toMatchObject(empty);
    expect(await db.flexValues.count()).toBe(8);
    expect((await db.flexValues.toArray()).every(row => row.entityId === 'tg:202'
      && row.realmId === 'tg:202' && row.owner === 'tg:202')).toBe(true);
    await repo.updateOwn({ ...empty, birthDate: '2000-01-01' });
    await repo.updateOwn(empty);
    expect(await repo.readOwn()).toMatchObject(empty);
    expect(await db.flexValues.count()).toBe(8);
  });

  it('prefills verified Telegram fields without inventing birth date or contacts', () => {
    expect(initialUserProfile({ firstName: 'Ольга', lastName: 'Петрова' }))
      .toMatchObject({ firstName: 'Ольга', lastName: 'Петрова',
        birthDate: '', email: '', phone: '', weightKg: null });
    expect(ageFromBirthDate('2000-12-31', '2026-11-01')).toBe(25);
    expect(ageFromBirthDate('2000-11-01', '2026-11-01')).toBe(26);
    expect(validateUserProfile(draft, '2026-11-01')).toBeNull();
    expect(validateUserProfile({ ...draft, birthDate: '2027-01-01' }, '2026-11-01'))
      .toContain('дату рождения');
    expect(validateUserProfile({ ...draft, email: 'invalid' }, '2026-11-01')).toContain('E-mail');
  });

  it('stores an updatable personal profile in private realm and does not duplicate keys', async () => {
    const { db, repo } = create();
    await repo.saveOwn(draft);
    expect(await repo.readOwn()).toMatchObject(draft);
    await repo.saveOwn({ ...draft, weightKg: 63 });
    expect(await repo.readOwn()).toMatchObject({ weightKg: 63, firstName: 'Ольга' });
    expect(await db.flexValues.count()).toBe(8);
    const rows = await db.flexValues.toArray();
    expect(rows.every(row => row.owner === 'tg:202' && row.realmId === 'tg:202')).toBe(true);
  });

  it('never reads a different actor personal realm', async () => {
    const { db, repo } = create();
    await repo.saveOwn(draft);
    const foreign = new UserProfileRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
    expect(await foreign.readOwn()).toBeNull();
    await foreign.saveOwn({ ...draft, firstName: 'Другой' });
    expect(await repo.readOwn()).toMatchObject({ firstName: 'Ольга' });
    expect(await foreign.readOwn()).toMatchObject({ firstName: 'Другой' });
    expect(await db.flexValues.count()).toBe(16);
  });

  it('reacts to profile creation through the local Dexie query', async () => {
    const { repo } = create();
    const observed: Array<string | null> = [];
    const observer = repo.observeOwn(value => observed.push(value?.firstName ?? null), reason => {
      throw reason;
    });
    try {
      await vi.waitFor(() => expect(observed).toContain(null));
      await repo.saveOwn(draft);
      await vi.waitFor(() => expect(observed).toContain('Ольга'));
    } finally { observer.unsubscribe(); }
  });

  it('rejects malformed contact data without persisting the completed marker', async () => {
    const { db, repo } = create();
    await expect(repo.saveOwn({ ...draft, phone: 'abc' })).rejects.toThrow('Проверьте номер');
    expect(await db.flexValues.count()).toBe(0);
  });
});


const legacyKeys = {
  firstName: 'ClientIntake_FirstName', lastName: 'ClientIntake_LastName',
  email: 'ClientIntake_Email', phone: 'ClientIntake_Phone', birthDate: 'ClientIntake_BirthDate',
  sex: 'ClientIntake_Sex', weightKg: 'ClientIntake_WeightKg', updatedAt: 'ClientIntake_UpdatedAt',
};
async function seedLegacy(db: ProfileDb, firstName = 'До обновления', updatedAt = '2026-01-01T00:00:00.000Z') {
  const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
  const profile = { ...draft, firstName, updatedAt };
  await flexible.setValues({ entityType: 'user', entityId: 'tg:202', realmId: 'tg:202' },
    (Object.keys(legacyKeys) as Array<keyof typeof legacyKeys>).map(key => ({
      key: legacyKeys[key], valueType: key === 'weightKg' ? 'number' : 'string', value: profile[key],
    })));
  await flexible.setValue({ entityType: 'user', entityId: 'tg:202', realmId: 'tg:202' },
    { key: 'ClientIntake_Telegram', valueType: 'string', value: 'legacy_arbitrary_text' });
}

describe('legacy profile transition', () => {
  it('does not materialize missing optional legacy values before they synchronize', async () => {
    const { db, repo } = create();
    const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    const target = { entityType: 'user' as const, entityId: 'tg:202', realmId: 'tg:202' };
    await flexible.setValues(target, [
      { key: legacyKeys.firstName, valueType: 'string', value: 'До обновления' },
      { key: legacyKeys.birthDate, valueType: 'string', value: draft.birthDate },
      { key: legacyKeys.sex, valueType: 'string', value: draft.sex },
      { key: legacyKeys.updatedAt, valueType: 'string', value: '2026-01-01T00:00:00.000Z' },
    ]);
    await repo.migrateOwn();
    expect(await repo.readOwn()).toBeNull();
    expect((await db.flexAttributes.toArray()).some(row => row.key.startsWith('profile_'))).toBe(false);

    await seedLegacy(db);
    await repo.migrateOwn();
    expect(await repo.readOwn()).toMatchObject({ ...draft, firstName: 'До обновления',
      updatedAt: '2026-01-01T00:00:00.000Z' });
    const values = await db.flexValues.toArray();
    await repo.migrateOwn();
    expect(await db.flexValues.toArray()).toEqual(values);
  });

  it.each(['lastName', 'email', 'phone', 'weightKg'] as const)(
    'does not turn a mistyped legacy %s into an empty canonical value', async field => {
      const { db, repo } = create();
      const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
      const profile = { ...draft, updatedAt: '2026-01-01T00:00:00.000Z' };
      await flexible.setValues({ entityType: 'user', entityId: 'tg:202', realmId: 'tg:202' },
        (Object.keys(legacyKeys) as Array<keyof typeof legacyKeys>).map(key => ({
          key: legacyKeys[key],
          valueType: key === field ? (key === 'weightKg' ? 'string' : 'number')
            : key === 'weightKg' ? 'number' : 'string',
          value: key === field ? (key === 'weightKg' ? '62' : 123) : profile[key],
        })));
      await repo.migrateOwn();
      expect(await repo.readOwn()).toBeNull();
      expect((await db.flexAttributes.toArray()).some(row => row.key.startsWith('profile_'))).toBe(false);
    },
  );

  it('reads existing registration, upgrades atomically, and retains add-only definitions', async () => {
    const { db, repo } = create();
    await seedLegacy(db);
    expect(await repo.readOwn()).toMatchObject({ firstName: 'До обновления' });
    await repo.migrateOwn();
    const values = await db.flexValues.toArray();
    expect(await db.flexAttributes.count()).toBe(17);
    expect(values).toHaveLength(17);
    await repo.migrateOwn();
    expect(await db.flexValues.toArray()).toEqual(values);
    db.close();
    await db.open();
    expect(await new UserProfileRepository(db as unknown as MezfitCloudDatabase, 'tg:202').readOwn())
      .toMatchObject({ firstName: 'До обновления', updatedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('never overwrites newer canonical values, including cleared optional fields', async () => {
    const { db, repo } = create();
    await seedLegacy(db);
    await repo.saveOwn({ ...draft, firstName: 'Новое имя', email: '', weightKg: null });
    await repo.migrateOwn();
    expect(await repo.readOwn()).toMatchObject({ firstName: 'Новое имя', email: '', weightKg: null });
  });

  it('reacts when an older device synchronizes a newer legacy profile', async () => {
    const { db, repo } = create();
    await repo.saveOwn(draft);
    const observed: string[] = [];
    const sub = repo.observeOwn(value => { if (value) observed.push(value.firstName); }, reason => { throw reason; });
    try {
      await seedLegacy(db, 'Другое устройство', '2099-01-01T00:00:00.000Z');
      await vi.waitFor(() => expect(observed).toContain('Другое устройство'));
      await repo.migrateOwn();
      expect(await repo.readOwn()).toMatchObject({ firstName: 'Другое устройство' });
      const canonical = await db.flexAttributes.where('[realmId+key]').equals(['tg:202', 'profile_firstName']).first();
      expect((await db.flexValues.where('attributeId').equals(canonical!.id).first())?.value).toBe('Другое устройство');
    } finally { sub.unsubscribe(); }
  });

  it('does not overwrite an incomplete newer canonical download during migration', async () => {
    const { db, repo } = create();
    await seedLegacy(db);
    const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    await flexible.setValue({ entityType: 'user', entityId: 'tg:202', realmId: 'tg:202' },
      { key: 'profile_updatedAt', valueType: 'string', value: '2099-01-01T00:00:00.000Z' });
    await repo.migrateOwn();
    expect(await db.flexValues.count()).toBe(10);
  });

  it('preserves partial canonical fields before their timestamp arrives and refuses a stale save', async () => {
    const { db, repo } = create();
    await seedLegacy(db);
    const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    await flexible.setValue({ entityType: 'user', entityId: 'tg:202', realmId: 'tg:202' },
      { key: 'profile_firstName', valueType: 'string', value: 'Новое значение' });
    await repo.migrateOwn();
    await expect(repo.saveOwn(draft)).rejects.toThrow('не полностью');
    expect(await db.flexValues.count()).toBe(10);
    const values = await flexible.getValues({ entityType: 'user', entityId: 'tg:202', realmId: 'tg:202' });
    expect(values.find(row => row.key === 'profile_firstName')?.value).toBe('Новое значение');
  });

  it('rolls back the entire save if a late attribute conflicts with an add-only definition', async () => {
    const { db, repo } = create();
    await db.flexAttributes.add({ id: flexAttributeId('tg:202', 'profile_updatedAt'), realmId: 'tg:202',
      owner: 'tg:202', key: 'profile_updatedAt', valueType: 'number' });
    await expect(repo.createOwn(draft)).rejects.toThrow('FLEX_ATTRIBUTE_CONFLICT');
    expect(await db.flexValues.count()).toBe(0);
    expect(await db.flexAttributes.count()).toBe(1);
    expect(await repo.readOwn()).toBeNull();
  });

  it('shares one profile between role contexts and exposes explicit create/update contracts', async () => {
    const { db, repo: client } = create();
    const coach = new UserProfileRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    await client.createOwn(draft);
    await expect(coach.createOwn(draft)).rejects.toThrow('уже существует');
    await coach.updateOwn({ ...draft, firstName: 'Новое имя' });
    expect(await client.readOwn()).toMatchObject({ firstName: 'Новое имя' });
    expect(await db.flexValues.count()).toBe(8);
  });
});

async function profileLink(db: ProfileDb, coach = '101', client = '202') {
  const fixture = await relationshipMembership(coach, client);
  await db.table('realms').put({ ...fixture.realm, owner: null });
  await db.table('members').bulkPut(fixture.members.map(member => ({
    ...member, owner: null, accepted: true, invite: false,
  })));
  return fixture.realm.realmId;
}

describe('published profile defaults', () => {
  it('publishes every confirmed link idempotently and updates clears without touching overrides', async () => {
    const { db, repo } = create();
    const first = await profileLink(db);
    const second = await profileLink(db, '102');
    await repo.saveOwn(draft);
    await repo.publishOwn();
    expect(await repo.readPublished('tg:202', first)).toMatchObject(draft);
    expect(await repo.readPublished('tg:202', second)).toMatchObject(draft);
    const count = await db.flexValues.count();
    await repo.publishOwn();
    expect(await db.flexValues.count()).toBe(count);
    const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    const target = { entityType: 'publishedUser' as const, entityId: 'tg:202', realmId: first };
    await flexible.setValue(target, { key: 'override_firstName', valueType: 'string', value: 'Свой вариант' });
    await repo.saveOwn({ ...draft, phone: '', weightKg: null });
    await repo.publishOwn();
    expect(await repo.readPublished('tg:202', first)).toMatchObject({ phone: '', weightKg: null });
    expect((await flexible.getValues(target)).find(row => row.key === 'override_firstName')?.value).toBe('Свой вариант');
    expect((await db.flexValues.where('realmId').equals(first).toArray()).every(row => row.owner === first)).toBe(true);
  });

  it('publishes an existing profile to a newly confirmed relationship', async () => {
    const { db, repo } = create();
    await repo.saveOwn(draft);
    const versions: Array<string | null> = [];
    const subscription = repo.observePublicationVersion(version => versions.push(version), reason => { throw reason; });
    try {
      await vi.waitFor(() => expect(versions.length).toBeGreaterThan(0));
      const previous = versions[versions.length - 1];
      const realm = await profileLink(db);
      await vi.waitFor(() => expect(versions[versions.length - 1]).not.toBe(previous));
      await repo.publishOwn();
      expect(await repo.readPublished('tg:202', realm)).toMatchObject(draft);
    } finally { subscription.unsubscribe(); }
  });

  it('reads only an authorized shared profile and forbids peer writes and foreign personal realms', async () => {
    const { db, repo } = create();
    const realm = await profileLink(db);
    await repo.saveOwn(draft);
    await repo.publishOwn();
    const peer = new UserProfileRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
    expect(await peer.readPublished('tg:202', realm)).toMatchObject(draft);
    await expect(peer.readPublished('tg:202', 'tg:202')).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    const outsider = new UserProfileRepository(db as unknown as MezfitCloudDatabase, 'tg:303');
    await expect(outsider.readPublished('tg:202', realm)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:101');
    await expect(flexible.setValue({ entityType: 'publishedUser', entityId: 'tg:202', realmId: realm },
      { key: 'profile_firstName', valueType: 'string', value: 'Чужое изменение' })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    const before = await repo.publicationVersion();
    await db.table('members').where('userId').equals('tg:101').delete();
    expect(await repo.publicationVersion()).not.toBe(before);
    await expect(peer.readPublished('tg:202', realm)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
  });

  it('does not overwrite a newer published snapshot with a stale personal version', async () => {
    const { db, repo } = create();
    const realm = await profileLink(db);
    await repo.saveOwn(draft);
    await repo.publishOwn();
    const flexible = new FlexAttributesRepository(db as unknown as MezfitCloudDatabase, 'tg:202');
    await flexible.setValues({ entityType: 'publishedUser', entityId: 'tg:202', realmId: realm }, [
      { key: 'profile_firstName', valueType: 'string', value: 'Новее на другом устройстве' },
      { key: 'profile_updatedAt', valueType: 'string', value: '2099-01-01T00:00:00Z' },
    ]);
    await repo.publishOwn();
    expect(await repo.readPublished('tg:202', realm)).toMatchObject({ firstName: 'Новее на другом устройстве' });
  });

  it('keeps the private save when publication fails and retries the complete shared transaction', async () => {
    const { db, repo } = create();
    const first = await profileLink(db);
    const second = await profileLink(db, '102');
    await repo.saveOwn(draft);
    await db.flexAttributes.add({ id: flexAttributeId(second, 'profile_updatedAt'), realmId: second,
      owner: second, key: 'profile_updatedAt', valueType: 'number' });
    await expect(repo.publishOwn()).rejects.toThrow('FLEX_ATTRIBUTE_CONFLICT');
    expect(await repo.readOwn()).toMatchObject(draft);
    expect(await db.flexValues.where('realmId').equals(first).count()).toBe(0);
    expect(await db.flexValues.where('realmId').equals(second).count()).toBe(0);
  });

  it('never acknowledges edits committed during the public push barrier', async () => {
    const { db, repo } = create();
    await repo.saveOwn(draft);
    const version = await repo.publishOwn();
    if (!version) throw new Error('Missing publication version');
    let finish: (() => void) | undefined;
    const sync = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    Object.defineProperty(db, 'cloud', { value: { sync }, configurable: true });
    const confirmation = repo.confirmOwnSync(version);
    await repo.saveOwn({ ...draft, phone: '' });
    finish?.();
    expect(await confirmation).toBe(false);
    expect(sync).toHaveBeenCalledWith({ purpose: 'push', wait: true });
  });
});
