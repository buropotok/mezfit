import type Dexie from 'dexie';
import type { MezfitCloudDatabase } from './database';

/**
 * Flex definitions are scoped to a realm. A shared session never references
 * an attribute definition hidden in an athlete's personal realm.
 */
export type FlexEntityType = 'user' | 'adHocSession';
export type FlexValueType = 'string' | 'number' | 'boolean';
export type FlexPrimitive = string | number | boolean | null;

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
const encodeParts = (...parts: string[]): string =>
  parts.map(part => String(part.length) + ':' + part).join(':');

/** Deterministic IDs also provide uniqueness under repeat writes on separate devices. */
export function flexAttributeId(realmId: string, key: string): string {
  return 'flex-attribute:' + encodeParts(realmId, key);
}

export function flexValueId(target: FlexEntityTarget, attributeId: string): string {
  return 'flex-value:' + encodeParts(target.realmId, target.entityType, target.entityId, attributeId);
}

export function isFlexAttributeRow(value: unknown): value is FlexAttributeRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.realmId === 'string' && row.realmId.length > 0
    && typeof row.owner === 'string' && row.owner.length > 0
    && typeof row.key === 'string' && attributeKeyPattern.test(row.key)
    && (row.valueType === 'string' || row.valueType === 'number' || row.valueType === 'boolean')
    && row.id === flexAttributeId(row.realmId, row.key);
}

export function isValidFlexValue(valueType: FlexValueType, value: unknown): value is FlexPrimitive {
  if (value === null) return true;
  if (valueType === 'string') return typeof value === 'string' && value.length <= 1024;
  if (valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
}

function assertInput(entry: FlexAttributeInput): void {
  if (!attributeKeyPattern.test(entry.key)
    || !['string', 'number', 'boolean'].includes(entry.valueType)
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
type FlexTables = Pick<MezfitCloudDatabase, 'flexAttributes' | 'flexValues' | 'adHocSessions'>;

/** Keep Dexie's own transaction type coupled to the concrete database class. */
export class FlexAttributesRepository<TDatabase extends Dexie & FlexTables> {
  constructor(private readonly db: TDatabase, private readonly actorUserId: string) {
    if (!userIdPattern.test(actorUserId)) throw new Error('INVALID_FLEX_ACTOR');
  }

  private async assertTarget(target: FlexEntityTarget): Promise<void> {
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

  async getValues(target: FlexEntityTarget): Promise<FlexResolvedValue[]> {
    return this.db.transaction('r',
      this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions, async () => {
        await this.assertTarget(target);
        const values = await this.db.flexValues
          .where('[realmId+entityType+entityId]')
          .equals([target.realmId, target.entityType, target.entityId])
          .toArray();
        const resolved: FlexResolvedValue[] = [];
        const expectedOwner = ownerFor(target, this.actorUserId);
        for (const entry of values) {
          const attribute = await this.db.flexAttributes.get(entry.attributeId);
          if (!isFlexAttributeRow(attribute) || attribute.realmId !== target.realmId
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
    if (entries.length === 0) return;
    const keys = new Set<string>();
    for (const entry of entries) {
      assertInput(entry);
      if (keys.has(entry.key)) throw new Error('DUPLICATE_FLEX_ATTRIBUTE');
      keys.add(entry.key);
    }
    await this.db.transaction('rw',
      this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions, async () => {
        await this.assertTarget(target);
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
