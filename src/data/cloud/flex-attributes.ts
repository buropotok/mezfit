import type Dexie from 'dexie';
import { flexAttributeId, flexValueId } from '../../../shared/flex-identifiers';
export { flexAttributeId, flexValueId } from '../../../shared/flex-identifiers';
import { profileRelationships } from './user-profile-relationships';
import type { MezfitCloudDatabase } from './database';

/**
 * Flex definitions are scoped to a realm. A shared session never references
 * an attribute definition hidden in an athlete's personal realm.
 */
export type FlexEntityType = 'user' | 'adHocSession' | 'publishedUser';
export type FlexValueType = 'string' | 'number' | 'boolean' | 'avatar';
export interface FlexBlobReference { _bt: 'Blob'; ref: string; size: number; ct: 'image/jpeg' }
export interface FlexAvatarValue { version: string; revision: string; small: Blob | FlexBlobReference | null; large: Blob | FlexBlobReference | null }
export type FlexPrimitive = string | number | boolean | FlexAvatarValue | null;

export function isFlexAvatarValue(value: unknown): value is FlexAvatarValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const avatar = value as Record<string, unknown>;
  const valid = (image: unknown, limit: number) => image instanceof Blob
    ? image.type === 'image/jpeg' && image.size >= 16 && image.size <= limit
    : isFlexBlobReference(image) && image.size <= limit;
  return typeof avatar.version === 'string' && Number.isFinite(Date.parse(avatar.version))
    && typeof avatar.revision === 'string' && /^[a-f0-9-]{36}$/.test(avatar.revision)
    && ((avatar.small === null && avatar.large === null)
      || (valid(avatar.small, 50_000) && valid(avatar.large, 245_000)));
}

export function isFlexBlobReference(value: unknown): value is FlexBlobReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return ref._bt === 'Blob' && typeof ref.ref === 'string' && /^[0-9]+:[a-zA-Z0-9_-]{6,}$/.test(ref.ref)
    && typeof ref.size === 'number' && ref.size >= 16 && ref.size <= 245_000 && ref.ct === 'image/jpeg';
}

export interface FlexAttributeRow {
  id: string;
  realmId: string;
  owner: string;
  key: string;
  valueType: FlexValueType;
}

export interface FlexValueRow {
  id: string;
  realmId: string;
  owner: string;
  entityType: FlexEntityType;
  entityId: string;
  attributeId: string;
  value: FlexPrimitive;
}

export interface FlexEntityTarget {
  entityType: FlexEntityType;
  entityId: string;
  realmId: string;
}

export interface FlexAttributeInput {
  key: string;
  valueType: FlexValueType;
  value: FlexPrimitive;
}

export interface FlexResolvedValue {
  key: string;
  valueType: FlexValueType;
  value: FlexPrimitive;
}

const userIdPattern = /^tg:[1-9]\d*$/;
const attributeKeyPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export function isFlexAttributeRow(value: unknown): value is FlexAttributeRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.realmId === 'string' && row.realmId.length > 0
    && typeof row.owner === 'string' && row.owner.length > 0
    && typeof row.key === 'string' && attributeKeyPattern.test(row.key)
    && ['string', 'number', 'boolean', 'avatar'].includes(String(row.valueType))
    && row.id === flexAttributeId(row.realmId, row.key);
}

export function isValidFlexValue(valueType: FlexValueType, value: unknown): value is FlexPrimitive {
  if (value === null) return true;
  if (valueType === 'avatar') return isFlexAvatarValue(value);
  if (valueType === 'string') return typeof value === 'string' && value.length <= 1024;
  if (valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
}

function assertInput(entry: FlexAttributeInput): void {
  if (!attributeKeyPattern.test(entry.key)
    || !['string', 'number', 'boolean', 'avatar'].includes(entry.valueType)
    || !isValidFlexValue(entry.valueType, entry.value)) {
    throw new Error('INVALID_FLEX_ATTRIBUTE_VALUE');
  }
}

function ownerFor(target: FlexEntityTarget, actorUserId: string): string {
  return target.entityType === 'user' ? actorUserId : target.realmId;
}

/**
 * Domain boundary for flexible extension data. No component accesses the Dexie
 * tables directly; the supported entity types are intentionally explicit.
 * flexValues must never be interpreted as permissions or PLAN/FACT authority.
 */
type FlexTables = Pick<MezfitCloudDatabase, 'flexAttributes' | 'flexValues' | 'adHocSessions'>
  & Partial<Pick<MezfitCloudDatabase, 'realms' | 'members'>>;

/** Keep Dexie's own transaction type coupled to the concrete database class. */
export class FlexAttributesRepository<TDatabase extends Dexie & FlexTables> {
  constructor(private readonly db: TDatabase, private readonly actorUserId: string) {
    if (!userIdPattern.test(actorUserId)) throw new Error('INVALID_FLEX_ACTOR');
  }

  private targetTables(target: FlexEntityTarget) {
    const tables = [this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions];
    return target.entityType === 'publishedUser' && this.db.realms && this.db.members
      ? [...tables, this.db.realms, this.db.members] : tables;
  }

  private async assertTarget(target: FlexEntityTarget, writing = false, override = false): Promise<void> {
    if (target.entityType === 'publishedUser') {
      if (!this.db.realms || !this.db.members || (writing && !override && target.entityId !== this.actorUserId))
        throw new Error('FLEX_ENTITY_FORBIDDEN');
      const pairs = await profileRelationships({ realms: this.db.realms, members: this.db.members }, this.actorUserId);
      if (!pairs.some(pair => pair.realmId === target.realmId
        && (target.entityId === pair.coachUserId || target.entityId === pair.clientUserId)
        && (!override || (pair.coachUserId === this.actorUserId && pair.clientUserId === target.entityId))))
        throw new Error('FLEX_ENTITY_FORBIDDEN');
      return;
    }
    if (target.entityType === 'user') {
      if (target.realmId !== this.actorUserId || target.entityId !== this.actorUserId) {
        throw new Error('FLEX_ENTITY_FORBIDDEN');
      }
      return;
    }
    if (target.entityType !== 'adHocSession' || !target.entityId || !target.realmId) {
      throw new Error('INVALID_FLEX_TARGET');
    }
    const session = await this.db.adHocSessions.get(target.entityId);
    if (!session || session.realmId !== target.realmId
      || (session.athleteUserId !== this.actorUserId && session.coachUserId !== this.actorUserId)) {
      throw new Error('FLEX_ENTITY_FORBIDDEN');
    }
  }

  async getValues(target: FlexEntityTarget, keys?: readonly string[]): Promise<FlexResolvedValue[]> {
    return this.db.transaction('r',
      this.targetTables(target), async () => {
        await this.assertTarget(target);
        const values = keys
          ? (await this.db.flexValues.bulkGet(keys.map(key => flexValueId(target, flexAttributeId(target.realmId, key)))))
            .filter((row): row is FlexValueRow => row !== undefined)
          : await this.db.flexValues
          .where('[realmId+entityType+entityId]')
          .equals([target.realmId, target.entityType, target.entityId])
          .toArray();
        const resolved: FlexResolvedValue[] = [];
        const expectedOwner = ownerFor(target, this.actorUserId);
        for (const entry of values) {
          const attribute = await this.db.flexAttributes.get(entry.attributeId);
          // Shared values may download before their add-only definitions. Keep observing.
          if (!attribute && (target.entityType === 'publishedUser'
            || entry.attributeId === flexAttributeId(target.realmId, 'profile_avatar'))) continue;
          if (entry.realmId !== target.realmId || entry.entityType !== target.entityType || entry.entityId !== target.entityId
            || !isFlexAttributeRow(attribute) || attribute.realmId !== target.realmId
            || attribute.owner !== expectedOwner || entry.owner !== expectedOwner
            || entry.id !== flexValueId(target, attribute.id)
            || !isValidFlexValue(attribute.valueType, entry.value)) {
            throw new Error('INVALID_STORED_FLEX_VALUE');
          }
          resolved.push({ key: attribute.key, valueType: attribute.valueType, value: entry.value });
        }
        return resolved.sort((a, b) => a.key.localeCompare(b.key));
      });
  }

  /** Atomically register new keys and upsert their values in the target realm. */
  async setValues(target: FlexEntityTarget, entries: readonly FlexAttributeInput[]): Promise<void> {
    await this.writeValues(target, entries);
  }

  /** Coach-authored overrides for this relationship only; never write peer profile_* values. */
  async setProfileOverrides(target: FlexEntityTarget, entries: readonly FlexAttributeInput[]): Promise<void> {
    if (target.entityType !== 'publishedUser' || entries.some(entry => !entry.key.startsWith('override_')))
      throw new Error('FLEX_ENTITY_FORBIDDEN');
    await this.writeValues(target, entries, true);
  }

  private async writeValues(target: FlexEntityTarget, entries: readonly FlexAttributeInput[], override = false): Promise<void> {
    if (entries.length === 0) return;
    const keys = new Set<string>();
    for (const entry of entries) {
      assertInput(entry);
      if (keys.has(entry.key)) throw new Error('DUPLICATE_FLEX_ATTRIBUTE');
      keys.add(entry.key);
    }
    await this.db.transaction('rw',
      this.targetTables(target), async () => {
        await this.assertTarget(target, true, override);
        const owner = ownerFor(target, this.actorUserId);
        for (const entry of entries) {
          const attributeId = flexAttributeId(target.realmId, entry.key);
          const existing = await this.db.flexAttributes.get(attributeId);
          if (existing) {
            if (!isFlexAttributeRow(existing) || existing.realmId !== target.realmId
              || existing.owner !== owner || existing.valueType !== entry.valueType) {
              throw new Error('FLEX_ATTRIBUTE_CONFLICT');
            }
          } else {
            await this.db.flexAttributes.add({
              id: attributeId, realmId: target.realmId, owner,
              key: entry.key, valueType: entry.valueType,
            });
          }
          const valueId = flexValueId(target, attributeId);
          const previous = await this.db.flexValues.get(valueId);
          if (previous) {
            if (previous.realmId !== target.realmId || previous.owner !== owner
              || previous.entityType !== target.entityType || previous.entityId !== target.entityId
              || previous.attributeId !== attributeId) throw new Error('FLEX_VALUE_CONFLICT');
            if (previous.value !== entry.value) await this.db.flexValues.update(valueId, { value: entry.value });
          } else {
            await this.db.flexValues.add({
              id: valueId, realmId: target.realmId, owner,
              entityType: target.entityType, entityId: target.entityId,
              attributeId, value: entry.value,
            });
          }
        }
      });
  }

  async setValue(target: FlexEntityTarget, entry: FlexAttributeInput): Promise<void> {
    await this.setValues(target, [entry]);
  }

  /** Null is an explicit cleared value; physical deletes are not granted. */
  async clearValue(target: FlexEntityTarget, key: string, valueType: FlexValueType): Promise<void> {
    await this.setValue(target, { key, valueType, value: null });
  }
}
