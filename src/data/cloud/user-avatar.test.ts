import 'fake-indexeddb/auto';
import Dexie, { liveQuery, type Table } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import type { MezfitCloudDatabase } from './database';
import { flexAttributeId, flexValueId, type FlexAttributeRow, type FlexValueRow } from './flex-attributes';
import { UserAvatarRepository, USER_AVATAR_KEY } from './user-avatar';
import { UserProfileRepository } from './user-profile';
import { resolveContactNames } from './contact-presentation';

class AvatarDb extends Dexie {
  flexAttributes!: Table<FlexAttributeRow, string>;
  flexValues!: Table<FlexValueRow, string>;
  constructor() {
    super('user-avatar-' + crypto.randomUUID());
    this.version(1).stores({
      flexAttributes: 'id, realmId, [realmId+key]',
      flexValues: 'id, realmId, attributeId, [realmId+attributeId], [realmId+entityType+entityId]',
      adHocSessions: 'id', realms: 'realmId', members: 'id, realmId, userId',
    });
  }
}
const databases: AvatarDb[] = [];
const images = (marker: string) => ({ small: new Blob([marker.repeat(32)], { type: 'image/jpeg' }),
  large: new Blob([marker.repeat(64)], { type: 'image/jpeg' }) });
async function fixture() {
  const db = new AvatarDb(); databases.push(db);
  const database = db as unknown as MezfitCloudDatabase;
  const link = await relationshipMembership('101', '202');
  await db.table('realms').put({ ...link.realm, owner: null });
  await db.table('members').bulkPut(link.members.map(member => ({ ...member, owner: null, accepted: true, invite: false })));
  return { db, database, realmId: link.realm.realmId,
    client: new UserAvatarRepository(database, 'tg:202'), coach: new UserAvatarRepository(database, 'tg:101') };
}
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });

describe('local profile avatars', () => {
  it('stores variants atomically, reopens offline and publishes without requiring a saved questionnaire', async () => {
    const { db, database, client, coach, realmId } = await fixture();
    await client.save(images('a'));
    expect(await db.flexValues.count()).toBe(1);
    const own = await client.read();
    expect(own.incomplete).toBe(false);
    expect(own.value?.small).toBeInstanceOf(Blob);
    db.close(); await db.open();
    expect((await client.read()).value?.version).toBe(own.value?.version);
    // Production publication provider uses this same account-scoped entry point.
    const profile = new UserProfileRepository(database, 'tg:202');
    expect(await profile.publishOwn()).toBe(await profile.publicationVersion());
    expect((await coach.read('tg:202', realmId)).value?.version).toBe(own.value?.version);
    expect((await db.flexValues.toArray()).filter(row => row.realmId === realmId)
      .every(row => row.owner === realmId && row.entityId === 'tg:202')).toBe(true);
    const count = await db.flexValues.count();
    const version = await profile.publicationVersion();
    await profile.publishOwn();
    expect(await db.flexValues.count()).toBe(count);
    expect(await profile.publicationVersion()).toBe(version);
  });

  it('preserves a relationship override over new user images and resets to the latest publication', async () => {
    const { client, coach, realmId } = await fixture();
    await client.save(images('a')); await client.publishOwn();
    await coach.save(images('b'), { userId: 'tg:202', realmId });
    const override = await coach.read('tg:202', realmId);
    expect(override.overridden).toBe(true);
    expect((await client.read()).value?.version).not.toBe(override.value?.version);
    await client.save(images('c')); await client.publishOwn();
    expect((await coach.read('tg:202', realmId)).value?.version).toBe(override.value?.version);
    await coach.reset('tg:202', realmId);
    expect(await coach.read('tg:202', realmId)).toMatchObject({ overridden: false,
      value: { version: (await client.read()).value?.version } });
    await client.save(null); await client.publishOwn();
    expect((await coach.read('tg:202', realmId)).value).toMatchObject({ small: null, large: null });
  });

  it('isolates relationships and denies outsiders, Client overrides and foreign personal targets', async () => {
    const { db, database, client, coach, realmId } = await fixture();
    const other = await relationshipMembership('303', '202');
    await db.table('realms').put({ ...other.realm, owner: null });
    await db.table('members').bulkPut(other.members.map(member => ({ ...member, owner: null, accepted: true, invite: false })));
    await client.save(images('a')); await client.publishOwn();
    await coach.save(images('b'), { userId: 'tg:202', realmId });
    const otherCoach = new UserAvatarRepository(database, 'tg:303');
    expect((await otherCoach.read('tg:202', other.realm.realmId)).overridden).toBe(false);
    await expect(otherCoach.read('tg:202', realmId)).rejects.toThrow();
    await expect(client.save(images('c'), { userId: 'tg:101', realmId })).rejects.toThrow();
    await expect(coach.read('tg:202', 'tg:202')).rejects.toThrow();
    await expect(coach.reset('tg:202', other.realm.realmId)).rejects.toThrow();
  });

  it('publishes an existing image when a new relationship is added', async () => {
    const { db, client, database } = await fixture();
    await client.save(images('a')); await client.publishOwn();
    const second = await relationshipMembership('303', '202');
    await db.table('realms').put({ ...second.realm, owner: null });
    await db.table('members').bulkPut(second.members.map(member => ({ ...member, owner: null, accepted: true, invite: false })));
    await client.publishOwn();
    expect((await new UserAvatarRepository(database, 'tg:303').read('tg:202', second.realm.realmId)).value?.version)
      .toBe((await client.read()).value?.version);
  });

  it('distinguishes device writes sharing the same timestamp when confirming and publishing', async () => {
    const { db, client, coach, realmId } = await fixture();
    await client.save(images('a')); await client.publishOwn();
    const before = await client.publicationVersion();
    const target = { entityType: 'user' as const, entityId: 'tg:202', realmId: 'tg:202' };
    const id = flexValueId(target, flexAttributeId(target.realmId, USER_AVATAR_KEY));
    const original = (await client.read()).value;
    if (!original) throw new Error('missing avatar');
    const revision = crypto.randomUUID();
    // A remote device can win the same Flex value with a different image at the same time.
    await db.flexValues.update(id, { value: { ...original, ...images('b'), revision } });
    expect(await client.publicationVersion()).not.toBe(before);
    await client.publishOwn();
    expect((await coach.read('tg:202', realmId)).value?.revision).toBe(revision);
  });

  it('withholds partial definitions and BlobRefs rather than replacing an unhydrated image', async () => {
    const { db, client } = await fixture();
    await client.save(images('a'));
    const target = { entityType: 'user' as const, entityId: 'tg:202', realmId: 'tg:202' };
    const attributeId = flexAttributeId(target.realmId, USER_AVATAR_KEY);
    const id = flexValueId(target, attributeId);
    const row = await db.flexValues.get(id);
    if (!row || !row.value || typeof row.value !== 'object' || !('version' in row.value)) throw new Error('missing avatar');
    const value = { ...row.value, small: { _bt: 'Blob' as const, ref: '1:abcdefghi', ct: 'image/jpeg' as const, size: 32 } };
    await db.flexValues.update(id, { value });
    expect((await client.read()).incomplete).toBe(true);
    expect(await client.publishOwn()).toBe(false);
    await expect(client.save(images('b'))).rejects.toThrow('загружается');
    await db.flexValues.update(id, { value: row.value });
    const definition = await db.flexAttributes.get(attributeId);
    if (!definition) throw new Error('missing definition');
    // Simulate a replica receiving a value before its immutable definition.
    await db.flexAttributes.delete(attributeId);
    expect((await client.read()).incomplete).toBe(true);
    await db.flexAttributes.add(definition);
    expect((await client.read()).incomplete).toBe(false);
  });

  it('rolls back definition creation on failure and rejects unsupported images', async () => {
    const { db, client } = await fixture();
    vi.spyOn(db.flexValues, 'add').mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(client.save(images('a'))).rejects.toThrow('quota exceeded');
    expect(await db.flexAttributes.count()).toBe(0);
    expect(await db.flexValues.count()).toBe(0);
    await expect(client.save({ small: new Blob(['x'.repeat(32)], { type: 'image/png' }), large: images('a').large })).rejects.toThrow('INVALID_USER_AVATAR');
    expect(await db.flexValues.count()).toBe(0);
  });
});

describe('shared contact name projection', () => {
  it('updates every directory consumer after override, publication and reset without changing identity', async () => {
    const { database, realmId } = await fixture();
    const client = new UserProfileRepository(database, 'tg:202');
    const coach = new UserProfileRepository(database, 'tg:101');
    const contacts = [{ userId: 'tg:202', telegramUserId: '202', relationshipId: realmId, displayName: 'Telegram name' }];
    const draft = { firstName: 'Анна', lastName: 'Иванова', email: '', phone: '', birthDate: '', sex: 'undisclosed' as const, weightKg: null };
    const seen: string[] = [];
    const subscription = liveQuery(() => resolveContactNames(database, 'tg:101', contacts)).subscribe(rows => { seen.push(rows[0].displayName); });
    try {
      await vi.waitFor(() => expect(seen).toContain('Telegram name'));
      await client.saveOwn(draft); await client.publishOwn();
      await vi.waitFor(() => expect(seen.at(-1)).toBe('Анна Иванова'));
      await coach.saveContactOverrides('tg:202', realmId, { firstName: 'Моё имя' });
      await vi.waitFor(() => expect(seen.at(-1)).toBe('Моё имя Иванова'));
      await client.saveOwn({ ...draft, firstName: 'Новое имя', lastName: 'Петрова' }); await client.publishOwn();
      await vi.waitFor(() => expect(seen.at(-1)).toBe('Моё имя Петрова'));
      await coach.resetContactOverride('tg:202', realmId, 'firstName');
      await vi.waitFor(() => expect(seen.at(-1)).toBe('Новое имя Петрова'));
      expect((await resolveContactNames(database, 'tg:101', contacts))[0]).toMatchObject({ userId: 'tg:202', telegramUserId: '202', relationshipId: realmId });
      await coach.saveContactOverrides('tg:202', realmId, { firstName: '', lastName: '' });
      expect((await resolveContactNames(database, 'tg:101', contacts))[0].displayName).toBe('Пользователь Mezfit');
    } finally { subscription.unsubscribe(); }
  });
});
