import { liveQuery } from 'dexie';
import type { MezfitCloudDatabase } from './database';
import { FlexAttributesRepository, flexAttributeId, flexValueId, isFlexAvatarValue,
  type FlexAvatarValue, type FlexEntityTarget } from './flex-attributes';
import { profileRelationships } from './user-profile-relationships';

export interface UserAvatarSnapshot {
  value: FlexAvatarValue | null;
  overridden: boolean;
  incomplete: boolean;
}
export const USER_AVATAR_KEY = 'profile_avatar';
export const OVERRIDE_AVATAR_KEY = 'override_avatar';
export function avatarReady(value: FlexAvatarValue | null): boolean {
  return !value || (value.small === null && value.large === null)
    || (value.small instanceof Blob && value.large instanceof Blob);
}
function signature(snapshot: UserAvatarSnapshot) {
  return [snapshot.value?.version ?? null, snapshot.value?.revision ?? null, snapshot.incomplete];
}

/** Avatar variants and their version are one Flex value, so no mixed revisions are published. */
export class UserAvatarRepository {
  private readonly flexible: FlexAttributesRepository<MezfitCloudDatabase>;
  constructor(private readonly db: MezfitCloudDatabase, readonly actorUserId: string) {
    this.flexible = new FlexAttributesRepository(db, actorUserId);
  }
  private tables() { return [this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions, this.db.realms, this.db.members]; }
  private target(userId: string, realmId: string): FlexEntityTarget {
    return userId === this.actorUserId && realmId === this.actorUserId
      ? { entityType: 'user', entityId: userId, realmId }
      : { entityType: 'publishedUser', entityId: userId, realmId };
  }
  private async readTarget(target: FlexEntityTarget, overrides: boolean): Promise<UserAvatarSnapshot> {
    const keys = overrides ? [USER_AVATAR_KEY, OVERRIDE_AVATAR_KEY] : [USER_AVATAR_KEY];
    const values = await this.flexible.getValues(target, keys);
    const expected = await this.db.flexValues.bulkGet(keys.map(key => flexValueId(target, flexAttributeId(target.realmId, key))));
    const rows = values.filter(row => keys.includes(row.key));
    const overridden = rows.some(row => row.key === OVERRIDE_AVATAR_KEY && row.value !== null);
    const selected = rows.find(row => row.key === (overridden ? OVERRIDE_AVATAR_KEY : USER_AVATAR_KEY));
    if (selected && (selected.valueType !== 'avatar' || (selected.value !== null && !isFlexAvatarValue(selected.value))))
      throw new Error('INVALID_USER_AVATAR');
    const value = selected && isFlexAvatarValue(selected.value) ? selected.value : null;
    return { value, overridden, incomplete: expected.filter(Boolean).length > rows.length || !avatarReady(value) };
  }
  async read(userId = this.actorUserId, realmId = this.actorUserId): Promise<UserAvatarSnapshot> {
    return this.db.transaction('r', this.tables(), () => this.readTarget(this.target(userId, realmId), realmId !== this.actorUserId));
  }
  observe(userId: string, realmId: string, next: (avatar: UserAvatarSnapshot) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.read(userId, realmId)).subscribe({ next, error });
  }
  async save(images: { small: Blob; large: Blob } | null, contact?: { userId: string; realmId: string }): Promise<void> {
    if (images !== null && (!images || !(images.small instanceof Blob) || !(images.large instanceof Blob)))
      throw new Error('INVALID_USER_AVATAR');
    const target = contact ? this.target(contact.userId, contact.realmId) : this.target(this.actorUserId, this.actorUserId);
    await this.db.transaction('rw', this.tables(), async () => {
      const previous = await this.readTarget(target, Boolean(contact));
      if (previous.incomplete) throw new Error('Аватар ещё загружается. Повторите позже.');
      const value: FlexAvatarValue = {
        revision: crypto.randomUUID(),
        version: new Date(Math.max(Date.now(), previous.value ? Date.parse(previous.value.version) + 1 : 0)).toISOString(),
        small: images?.small ?? null, large: images?.large ?? null,
      };
      if (!isFlexAvatarValue(value)) throw new Error('INVALID_USER_AVATAR');
      const entries = [{ key: contact ? OVERRIDE_AVATAR_KEY : USER_AVATAR_KEY, valueType: 'avatar' as const, value }];
      if (contact) await this.flexible.setProfileOverrides(target, entries);
      else await this.flexible.setValues(target, entries);
    });
  }
  async reset(userId: string, realmId: string): Promise<void> {
    await this.flexible.setProfileOverrides(this.target(userId, realmId),
      [{ key: OVERRIDE_AVATAR_KEY, valueType: 'avatar', value: null }]);
  }
  async publicationVersion(): Promise<string | null> {
    return this.db.transaction('r', this.tables(), async () => {
      const own = await this.read();
      if (!own.value && !own.incomplete) return null;
      const copies: unknown[] = [];
      for (const pair of await profileRelationships(this.db, this.actorUserId)) {
        const copy = await this.readTarget(this.target(this.actorUserId, pair.realmId), false);
        copies.push([pair.realmId, signature(copy)]);
      }
      return JSON.stringify([signature(own), copies]);
    });
  }
  async publishOwn(): Promise<boolean> {
    return this.db.transaction('rw', this.tables(), async () => {
      const own = await this.read();
      if (own.incomplete) return false;
      if (!own.value) return true;
      let complete = true;
      for (const pair of await profileRelationships(this.db, this.actorUserId)) {
        const target = this.target(this.actorUserId, pair.realmId);
        const previous = await this.readTarget(target, false);
        if (previous.incomplete) { complete = false; continue; }
        if (previous.value && (Date.parse(previous.value.version) > Date.parse(own.value.version)
          || previous.value.revision === own.value.revision)) continue;
        await this.flexible.setValues(target, [{ key: USER_AVATAR_KEY, valueType: 'avatar', value: own.value }]);
      }
      return complete;
    });
  }
}
