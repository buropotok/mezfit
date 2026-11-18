import Dexie from 'dexie';
import { FREE_DISCUSSION_ID_PREFIX } from '../../../shared/discussion-anchor';
import { flexAttributeId, flexValueId } from '../../../shared/flex-identifiers';
import { isFlexAttributeRow } from './flex-attributes';
import type { DiscussionThread } from './discussion-contracts';
import type { MezfitCloudDatabase } from './database';

export type DiscussionDeletionTables = Pick<MezfitCloudDatabase, 'flexAttributes' | 'flexValues'>;

function deletionMarker(thread: DiscussionThread, actor: string) {
  const key = 'discussion_deleted_' + thread.id.slice(FREE_DISCUSSION_ID_PREFIX.length).replaceAll('-', '');
  const target = { entityType: 'publishedUser' as const, entityId: actor, realmId: thread.realmId };
  const attributeId = flexAttributeId(thread.realmId, key);
  return { key, target, attributeId, id: flexValueId(target, attributeId) };
}

/** Callers supply a verified thread and participant from the current realm transaction. */
export function deletedDiscussionIds(
  db: Pick<DiscussionDeletionTables, 'flexValues'>, threads: readonly DiscussionThread[], actor: string,
): Promise<Set<string>> {
  const markers = threads.filter(thread => thread.anchor.kind === 'free')
    .map(thread => ({ thread, ...deletionMarker(thread, actor) }));
  if (!markers.length) return Dexie.Promise.resolve(new Set<string>());
  return db.flexValues.bulkGet(markers.map(marker => marker.id)).then(rows =>
    new Set(markers.flatMap(({ thread, id, attributeId, target }, index) => {
      const row = rows[index];
      // The exact monotone tombstone is sufficient even when Addon delivers the definition later.
      return row?.id === id && row.realmId === target.realmId && row.owner === target.realmId
        && row.entityType === target.entityType && row.entityId === target.entityId
        && row.attributeId === attributeId && row.value === true ? [thread.id] : [];
    })));
}

export async function storeDiscussionDeletion(
  db: DiscussionDeletionTables, thread: DiscussionThread, actor: string,
): Promise<void> {
  if (thread.anchor.kind !== 'free' || thread.coachClientId === null) throw new Error('DISCUSSION_CANNOT_BE_DELETED');
  const { key, target, attributeId, id } = deletionMarker(thread, actor);
  const owner = thread.realmId;
  const attribute = await db.flexAttributes.get(attributeId);
  if (attribute) {
    if (!isFlexAttributeRow(attribute) || attribute.realmId !== thread.realmId || attribute.owner !== owner
      || attribute.key !== key || attribute.valueType !== 'boolean') throw new Error('FLEX_ATTRIBUTE_CONFLICT');
  } else {
    await db.flexAttributes.add({ id: attributeId, key, realmId: thread.realmId, owner, valueType: 'boolean' });
  }
  const previous = await db.flexValues.get(id);
  if (previous) {
    if (previous.realmId !== target.realmId || previous.owner !== owner || previous.attributeId !== attributeId
      || previous.entityType !== target.entityType || previous.entityId !== target.entityId
      || previous.value !== true) throw new Error('FLEX_VALUE_CONFLICT');
    return;
  }
  await db.flexValues.add({ ...target, id, attributeId, owner, value: true });
}
