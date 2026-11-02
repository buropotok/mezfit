import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import { FlexAttributesRepository, flexAttributeId, flexValueId, type FlexAttributeRow, type FlexValueRow } from './flex-attributes';
import { UserProfileRepository, USER_PROFILE_OVERRIDE_KEYS, type UserProfileDraft, type ContactUserProfile } from './user-profile';

class ProfileDb extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  constructor() {
    super('profile-overrides-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: 'id, realmId, [realmId+key]',
      flexValues: 'id, realmId, attributeId, [realmId+attributeId], [realmId+entityType+entityId]',
      adHocSessions: 'id', realms: 'realmId', members: 'id, realmId, userId',
    });
  }
}
const databases: ProfileDb[] = [];
const draft: UserProfileDraft = { firstName: 'Анна', lastName: 'Иванова', email: '', phone: '',
  birthDate: '2000-01-01', sex: 'female', weightKg: 62 };
async function fixture() {
  const db = new ProfileDb();
  databases.push(db);
  const database = db as unknown as MezfitCloudDatabase;
  const link = await relationshipMembership('101', '202');
  await db.table('realms').put({ ...link.realm, owner: null });
  await db.table('members').bulkPut(link.members.map(member => ({ ...member, owner: null, accepted: true, invite: false })));
  const realmId = link.realm.realmId;
  const client = new UserProfileRepository(database, 'tg:202');
  const coach = new UserProfileRepository(database, 'tg:101');
  await client.saveOwn(draft);
  await client.publishOwn();
  return { db, database, client, coach, realmId,
    target: { entityType: 'publishedUser' as const, entityId: 'tg:202', realmId } };
}
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); });

describe('relationship profile overrides', () => {
  it('keeps explicit overrides over new publications and resets to the latest published value', async () => {
    const { client, coach, realmId, db } = await fixture();
    const version = await client.publicationVersion();
    const saved = await coach.saveContactOverrides('tg:202', realmId, { firstName: '  Моё имя  ', weightKg: null, birthDate: '' });
    expect(saved.profile).toMatchObject({ firstName: 'Моё имя', weightKg: null, birthDate: '' });
    expect(saved.overridden).toEqual(expect.arrayContaining(['firstName', 'weightKg', 'birthDate']));
    expect(await client.publicationVersion()).toBe(version);
    expect(await client.readOwn()).toMatchObject(draft);
    await client.saveOwn({ ...draft, firstName: 'Новое имя клиента', lastName: 'Новая фамилия', weightKg: 70 });
    await client.publishOwn();
    expect((await coach.readContact('tg:202', realmId)).profile).toMatchObject({
      firstName: 'Моё имя', lastName: 'Новая фамилия', weightKg: null, birthDate: '',
    });
    expect(await coach.readPublished('tg:202', realmId)).toMatchObject({ firstName: 'Новое имя клиента', weightKg: 70 });
    const reset = await coach.resetContactOverride('tg:202', realmId, 'firstName');
    expect(reset.profile?.firstName).toBe('Новое имя клиента');
    expect(reset.overridden).not.toContain('firstName');
    const attributeId = flexAttributeId(realmId, USER_PROFILE_OVERRIDE_KEYS.firstName);
    expect((await db.flexValues.get(flexValueId({ entityType: 'publishedUser', entityId: 'tg:202', realmId }, attributeId)))?.value).toBeNull();
  });

  it('persists explicit empty values, reopens and does not duplicate repeated writes or resets', async () => {
    const { db, coach, realmId } = await fixture();
    await coach.saveContactOverrides('tg:202', realmId, { firstName: '', lastName: '', email: ' TEST@EXAMPLE.COM ', phone: '', sex: 'undisclosed' });
    const count = await db.flexValues.count();
    await coach.saveContactOverrides('tg:202', realmId, { firstName: '', lastName: '', email: 'test@example.com', phone: '', sex: 'undisclosed' });
    expect(await db.flexValues.count()).toBe(count);
    db.close(); await db.open();
    expect((await coach.readContact('tg:202', realmId)).profile).toMatchObject({
      firstName: '', lastName: '', email: 'test@example.com', phone: '', sex: 'undisclosed',
    });
    await coach.resetContactOverride('tg:202', realmId, 'email');
    await coach.resetContactOverride('tg:202', realmId, 'email');
    expect(await db.flexValues.count()).toBe(count);
    expect((await coach.readContact('tg:202', realmId)).profile?.email).toBe('');
  });

  it('isolates Coaches and denies outsiders, self overrides and Client mutations', async () => {
    const { db, database, client, coach, realmId } = await fixture();
    const second = await relationshipMembership('303', '202');
    await db.table('realms').put({ ...second.realm, owner: null });
    await db.table('members').bulkPut(second.members.map(member => ({ ...member, owner: null, accepted: true, invite: false })));
    await client.publishOwn();
    await coach.saveContactOverrides('tg:202', realmId, { firstName: 'Только первая связь' });
    const secondCoach = new UserProfileRepository(database, 'tg:303');
    expect((await secondCoach.readContact('tg:202', second.realm.realmId)).profile?.firstName).toBe('Анна');
    await expect(secondCoach.saveContactOverrides('tg:202', realmId, { firstName: 'Запрещено' })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(coach.readContact('tg:202', 'tg:202')).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(coach.saveContactOverrides('tg:101', realmId, { firstName: 'Себе' })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(client.saveContactOverrides('tg:202', realmId, { firstName: 'Чужой override' })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(client.resetContactOverride('tg:202', realmId, 'firstName')).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    const outsider = new UserProfileRepository(database, 'tg:404');
    await expect(outsider.readContact('tg:202', realmId)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(outsider.resetContactOverride('tg:202', realmId, 'firstName')).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await db.table('members').where('userId').equals('tg:101').delete();
    await expect(coach.resetContactOverride('tg:202', realmId, 'firstName')).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
  });

  it('never widens ordinary peer profile writes or permits profile keys through the override API', async () => {
    const { database, target } = await fixture();
    const flex = new FlexAttributesRepository(database, 'tg:101');
    await expect(flex.setValue(target, { key: 'profile_firstName', valueType: 'string', value: 'Запрещено' })).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(flex.setProfileOverrides(target, [{ key: 'profile_firstName', valueType: 'string', value: 'Запрещено' }])).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
  });

  it('rejects invalid fields and values before writing any part of the patch', async () => {
    const { db, coach, realmId } = await fixture();
    const count = await db.flexValues.count();
    for (const patch of [
      { firstName: 'Новое', phone: 'abc' }, { weightKg: 0 }, { birthDate: '2099-01-01' },
      { sex: 'invalid' }, { telegramId: '303' }, { updatedAt: '2099-01-01' }, { avatar: 'blob' },
    ]) {
      await expect(coach.saveContactOverrides('tg:202', realmId, patch as Partial<UserProfileDraft>)).rejects.toThrow();
    }
    expect(await db.flexValues.count()).toBe(count);
    expect((await coach.readContact('tg:202', realmId)).profile).toMatchObject(draft);
  });

  it('rolls back earlier fields on an add-only definition conflict and permits retry', async () => {
    const { db, coach, realmId } = await fixture();
    // An unrelated conflicting last definition makes the entire multi-field batch fail.
    await db.flexAttributes.add({ id: flexAttributeId(realmId, USER_PROFILE_OVERRIDE_KEYS.weightKg),
      realmId, owner: realmId, key: USER_PROFILE_OVERRIDE_KEYS.weightKg, valueType: 'number' });
    const count = await db.flexValues.count();
    await expect(coach.saveContactOverrides('tg:202', realmId, { firstName: 'Новое', weightKg: 70 })).rejects.toThrow('FLEX_ATTRIBUTE_CONFLICT');
    expect(await db.flexValues.count()).toBe(count);
    expect(await db.flexAttributes.get(flexAttributeId(realmId, USER_PROFILE_OVERRIDE_KEYS.firstName))).toBeUndefined();
    await coach.saveContactOverrides('tg:202', realmId, { firstName: 'Повтор' });
    expect((await coach.readContact('tg:202', realmId)).profile?.firstName).toBe('Повтор');
  });

  it('observes late definitions and protects an incomplete override download from a stale editor', async () => {
    const { db, coach, realmId, target } = await fixture();
    const attributeId = flexAttributeId(realmId, USER_PROFILE_OVERRIDE_KEYS.firstName);
    await db.flexValues.add({ ...target, id: flexValueId(target, attributeId), owner: realmId,
      attributeId, value: 'Другое устройство' });
    const observed: ContactUserProfile[] = [];
    const sub = coach.observeContact('tg:202', realmId, value => observed.push(value), reason => { throw reason; });
    try {
      await vi.waitFor(() => expect(observed.some(value => value.incomplete)).toBe(true));
      await expect(coach.saveContactOverrides('tg:202', realmId, { firstName: 'Устаревшее' })).rejects.toThrow('не полностью');
      await db.flexAttributes.add({ id: attributeId, realmId, owner: realmId, key: USER_PROFILE_OVERRIDE_KEYS.firstName, valueType: 'string' });
      await vi.waitFor(() => expect(observed.some(value => !value.incomplete && value.profile?.firstName === 'Другое устройство')).toBe(true));
    } finally { sub.unsubscribe(); }
  });

  it('fails visibly on malformed stored overrides and can reset them without deleting definitions', async () => {
    const { db, database, target, coach, realmId } = await fixture();
    const flex = new FlexAttributesRepository(database, 'tg:101');
    await flex.setProfileOverrides(target, [{ key: USER_PROFILE_OVERRIDE_KEYS.weightKg, valueType: 'string', value: '0' }]);
    await expect(coach.readContact('tg:202', realmId)).rejects.toThrow('Укажите вес');
    const count = await db.flexAttributes.count();
    expect((await coach.resetContactOverride('tg:202', realmId, 'weightKg')).profile?.weightKg).toBe(62);
    expect(await db.flexAttributes.count()).toBe(count);
  });
});

it('commits override save and reset offline without awaiting or controlling cloud transport', async () => {
  const { db, coach, realmId } = await fixture();
  const sync = vi.fn().mockRejectedValue(new Error('Offline'));
  Object.defineProperty(db, 'cloud', { value: { sync }, configurable: true });
  expect((await coach.saveContactOverrides('tg:202', realmId, { firstName: 'Офлайн' })).profile?.firstName).toBe('Офлайн');
  expect((await coach.resetContactOverride('tg:202', realmId, 'firstName')).profile?.firstName).toBe('Анна');
  expect(sync).not.toHaveBeenCalled();
});
