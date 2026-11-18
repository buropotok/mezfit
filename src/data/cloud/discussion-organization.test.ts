// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { CLOUD_DATABASE_STORES_V17, type MezfitCloudDatabase } from './database';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread, prepareFreeDiscussion, readDiscussionNotificationThread } from './discussions';
import { FlexAttributesRepository, flexAttributeId, flexValueId, type FlexEntityTarget } from './flex-attributes';
import {
  DiscussionOrganizationRepository, DISCUSSION_CATEGORY_NAME_MAX_LENGTH,
  DISCUSSION_CATEGORY_KEY_PREFIX, decodeThreadAssignment, decodeCategoryDefinition,
  encodeCategoryDefinition, discussionCategoryKey, discussionThreadAssignmentKey,
  type CategoryId,
} from './discussion-organization';

class OrganizationTestDb extends Dexie {
  declare flexAttributes: MezfitCloudDatabase['flexAttributes'];
  declare flexValues: MezfitCloudDatabase['flexValues'];
  declare adHocSessions: MezfitCloudDatabase['adHocSessions'];
  declare discussionThreads: MezfitCloudDatabase['discussionThreads'];
  declare discussionMessages: MezfitCloudDatabase['discussionMessages'];
  declare discussionReadStates: MezfitCloudDatabase['discussionReadStates'];
  declare messageAttachments: MezfitCloudDatabase['messageAttachments'];
  declare realms: MezfitCloudDatabase['realms'];
  declare members: MezfitCloudDatabase['members'];
  constructor() {
    super('discussion-organization-' + crypto.randomUUID(), { addons: [dexieCloud] });
    this.version(17).stores(CLOUD_DATABASE_STORES_V17);
    this.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false });
    databases.push(this);
  }
}
const databases: OrganizationTestDb[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) { db.close(); await db.delete(); }
  vi.restoreAllMocks();
});
const anchor = { kind: 'program' as const, trainingPlanId: 'shared-program-id' };
const target = (userId: string, realmId = userId): FlexEntityTarget =>
  userId === realmId ? { entityType: 'user', entityId: userId, realmId }
    : { entityType: 'publishedUser', entityId: userId, realmId };
async function fixture() {
  const db = new OrganizationTestDb(); await db.open();
  const pairs = await Promise.all([
    relationshipMembership('11', '22'), relationshipMembership('11', '44'), relationshipMembership('33', '22'),
  ]);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.backendDB().transaction(['realms', 'members'], 'readwrite');
    for (const pair of pairs) {
      transaction.objectStore('realms').put(pair.realm);
      for (const member of pair.members) transaction.objectStore('members').put(member);
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  const scope = (index: number) => ({ realmId: pairs[index].realm.realmId, coachClientId: pairs[index].realm.realmId });
  const discussion = (userId: string, index: number) => new DiscussionRepository(db, userId, scope(index));
  const entity = await discussion('tg:11', 0).ensureEntityThread(anchor, 'Программа');
  const other = await discussion('tg:11', 1).ensureEntityThread(anchor, 'Программа');
  const free = await discussion('tg:22', 0).createFreeDiscussion(prepareFreeDiscussion('Свободный'));
  const personal = await new DiscussionRepository(db, 'tg:22', { realmId: 'tg:22', coachClientId: null })
    .createThread(prepareDiscussionThread(anchor, 'Личная', '2026-11-17'));
  return { db, scope, entity, other, free, personal,
    coach: new DiscussionOrganizationRepository(db, 'tg:11'),
    client: new DiscussionOrganizationRepository(db, 'tg:22'),
    otherClient: new DiscussionOrganizationRepository(db, 'tg:44') };
}

describe('discussion organization codecs', () => {
  it('separates namespaced 160-bit thread keys across realms and IDs', async () => {
    const id = '82cf2c4b-b4e0-4758-8dda-3f9c80f566ee' as CategoryId;
    const key = discussionCategoryKey(id);
    expect(key).toMatch(/^discussion_group_[a-f0-9]{32}$/);
    const thread = { id: 'entity-discussion:' + 'f'.repeat(64), realmId: 'realm-1' };
    const first = await discussionThreadAssignmentKey(thread);
    expect(first).toMatch(/^discussion_thread_[a-f0-9]{40}$/);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).toBe(await discussionThreadAssignmentKey(thread));
    expect(first).not.toBe(await discussionThreadAssignmentKey({ ...thread, realmId: 'realm-2' }));
    expect(first).not.toBe(await discussionThreadAssignmentKey({ ...thread, id: 'another' }));
    expect(first).not.toBe(key);
    expect(decodeThreadAssignment('training')).toBeNull();
    expect(decodeThreadAssignment('coach')).toBeNull();
    expect(decodeThreadAssignment('+')).toBeNull();
    expect(decodeThreadAssignment('custom:not-a-uuid')).toBeNull();
    expect(decodeThreadAssignment('personal')).toBe('personal');
    expect(decodeThreadAssignment('custom:' + id)).toBe('custom:' + id);
  });
  it('strictly validates bounded category JSON without embedding names into the key', () => {
    const id = '82cf2c4b-b4e0-4758-8dda-3f9c80f566ee' as CategoryId;
    const category = { id, name: ' План ', order: 4 };
    const encoded = encodeCategoryDefinition(category);
    expect(decodeCategoryDefinition(discussionCategoryKey(id), encoded))
      .toEqual({ ...category, name: 'План' });
    expect(decodeCategoryDefinition(discussionCategoryKey(id), '{"v":1,"name":"План","order":4,"extra":1}')).toBeNull();
    expect(decodeCategoryDefinition(discussionCategoryKey(id), '{"v":1,"name":"План","order":-1}')).toBeNull();
    expect(decodeCategoryDefinition('discussion_group_bad', encoded)).toBeNull();
    expect(() => encodeCategoryDefinition({ ...category, name: 'a'.repeat(DISCUSSION_CATEGORY_NAME_MAX_LENGTH + 1) })).toThrow();
  });
});

describe('typed Flex persistence and participant isolation', () => {
  it('keeps many category values separate, stable over rename/reorder and private to the actor', async () => {
    const { db, coach, client } = await fixture();
    const first = await coach.createCategory(' Техника ');
    for (let i = 0; i < 30; i++) await coach.createCategory('Группа ' + i);
    expect((await coach.listCategories()).length).toBe(31);
    expect((await db.flexAttributes.where('realmId').equals('tg:11').toArray())
      .filter(row => row.key.startsWith(DISCUSSION_CATEGORY_KEY_PREFIX))).toHaveLength(31);
    expect(await client.listCategories()).toEqual([]);
    await expect(coach.createCategory('техника')).rejects.toThrow('DUPLICATE_DISCUSSION_CATEGORY_NAME');
    await expect(coach.createCategory('Тренировки')).rejects.toThrow('INVALID_DISCUSSION_CATEGORY_NAME');
    await expect(coach.createCategory('  ')).rejects.toThrow('INVALID_DISCUSSION_CATEGORY_NAME');
    await coach.renameCategory(first.id, 'Новая техника');
    expect((await coach.listCategories()).find(row => row.id === first.id)?.name).toBe('Новая техника');
    const reverse = (await coach.listCategories()).map(row => row.id).reverse();
    await coach.reorderCategories(reverse);
    expect((await coach.listCategories()).map(row => row.id)).toEqual(reverse);
    await expect(coach.reorderCategories(reverse.slice(1))).rejects.toThrow('INVALID_DISCUSSION_CATEGORY_ORDER');
    const stored = await db.flexValues.get(flexValueId(target('tg:11'), flexAttributeId('tg:11', discussionCategoryKey(first.id))));
    expect(stored?.value).toContain('Новая техника');
  });

  it('keeps reads reactive but rejects category edits while a definition is awaiting its value', async () => {
    const { db, coach } = await fixture();
    const existing = await coach.createCategory('Первая');
    const pendingId = '49a87f72-f6d9-478a-afba-893f7eb65790' as CategoryId;
    const key = discussionCategoryKey(pendingId);
    await db.flexAttributes.add({ id: flexAttributeId('tg:11', key), realmId: 'tg:11',
      owner: 'tg:11', key, valueType: 'string' });
    expect((await coach.readCategories()).diagnostics).toContain('CATEGORY_PENDING:' + key);
    await expect(coach.createCategory('Новая')).rejects.toThrow('DISCUSSION_CATEGORIES_INCOMPLETE');
    await expect(coach.renameCategory(existing.id, 'Переименованная'))
      .rejects.toThrow('DISCUSSION_CATEGORIES_INCOMPLETE');
    await expect(coach.reorderCategories([existing.id])).rejects.toThrow('DISCUSSION_CATEGORIES_INCOMPLETE');
    await new FlexAttributesRepository(db, 'tg:11').clearValue(target('tg:11'), key, 'string');
    expect((await coach.readCategories()).diagnostics).toEqual([]);
    await coach.renameCategory(existing.id, 'Переименованная');
    expect((await coach.listCategories())[0]?.name).toBe('Переименованная');
  });

  it('shares basic and clear actions, while keeping independently selected private folders', async () => {
    const { entity, free, personal, coach, client } = await fixture();
    expect((await coach.classifyThreads([entity, free])).threads.map(row => row.category)).toEqual(['training', 'uncategorized']);
    expect((await client.getThreadOrganization(personal)).category).toBe('training');
    const secret = await coach.createCategory('Только для тренера');
    const privateFolder = await client.createCategory('Только для клиента');
    await coach.assignThread(entity, { kind: 'custom', id: secret.id });
    expect(await coach.getThreadOrganization(entity)).toMatchObject({ category: { kind: 'custom', id: secret.id }, diagnostics: [] });
    const counterpart = await client.getThreadOrganization(entity);
    expect(counterpart.category).toBe('coach');
    expect(counterpart.diagnostics).toEqual([]);
    expect(JSON.stringify(counterpart)).not.toContain(secret.name);
    await client.assignThread(entity, { kind: 'custom', id: privateFolder.id });
    expect((await client.getThreadOrganization(entity)).category).toEqual({ kind: 'custom', id: privateFolder.id });
    expect((await coach.getThreadOrganization(entity)).category).toEqual({ kind: 'custom', id: secret.id });
    await client.assignThread(entity, 'nutrition');
    expect((await client.getThreadOrganization(entity)).category).toBe('nutrition');
    expect((await coach.getThreadOrganization(entity)).category).toBe('nutrition');
    await client.clearThreadAssignment(entity);
    expect((await client.getThreadOrganization(entity)).category).toBe('uncategorized');
    expect((await coach.getThreadOrganization(entity)).category).toBe('uncategorized');
    await coach.assignThread(free, 'training');
    expect((await client.getThreadOrganization(free)).category).toBe('training');
    await client.assignThread(personal, 'nutrition');
    expect((await client.getThreadOrganization(personal)).category).toBe('nutrition');
    expect((await coach.classifyThreads([entity, entity])).threads).toHaveLength(1);
  });

  it('isolates multiple pairs, rejects foreign targets and never reads foreign personal categories', async () => {
    const { db, scope, entity, other, coach, client, otherClient } = await fixture();
    const category = await client.createCategory('Скрытый раздел');
    await client.assignThread(entity, { kind: 'custom', id: category.id });
    expect((await coach.getThreadOrganization(entity)).category).toBe('client');
    expect((await otherClient.getThreadOrganization(other)).category).toBe('training');
    await coach.assignThread(other, 'nutrition');
    expect((await otherClient.getThreadOrganization(other)).category).toBe('nutrition');
    await expect(otherClient.assignThread(entity, 'nutrition')).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    await expect(coach.getThreadOrganization({ ...entity, derivedTitleSnapshot: 'Подменённый заголовок' }))
      .rejects.toThrow('DISCUSSION_NOT_FOUND');
    await expect(coach.assignThread(entity, { kind: 'custom', id: category.id }))
      .rejects.toThrow('DISCUSSION_CATEGORY_NOT_FOUND');
    await expect(new DiscussionOrganizationRepository(db, 'tg:33').classifyThreads([entity]))
      .rejects.toThrow('DISCUSSION_ACCESS_DENIED');
    await expect(new FlexAttributesRepository(db, 'tg:11').setValue(target('tg:22', scope(0).realmId),
      { key: await discussionThreadAssignmentKey(entity), valueType: 'string', value: 'nutrition' }))
      .rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    expect(await coach.listCategories()).toEqual([]);
    expect(await otherClient.listCategories()).toEqual([]);
  });

  it('validates the actual shared Flex thread target for both writers and rejects mismatched realms', async () => {
    const { db, scope, entity } = await fixture();
    const threadTarget: FlexEntityTarget = { entityType: 'discussionThread', entityId: entity.id, realmId: entity.realmId };
    const entry = { key: 'discussion_category_selection', valueType: 'string' as const,
      value: JSON.stringify({ v: 1, base: 'nutrition' }) };
    const coach = new FlexAttributesRepository(db, 'tg:11');
    const client = new FlexAttributesRepository(db, 'tg:22');
    const outsider = new FlexAttributesRepository(db, 'tg:44');
    await coach.setValue(threadTarget, entry);
    expect(await client.getValues(threadTarget, [entry.key])).toEqual([entry]);
    const replacement = { ...entry, value: JSON.stringify({ v: 1, base: 'none' }) };
    await client.setValue(threadTarget, replacement);
    expect(await coach.getValues(threadTarget, [entry.key])).toEqual([replacement]);
    const mismatched = { ...threadTarget, realmId: scope(1).realmId };
    await expect(coach.setValue(mismatched, entry)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(outsider.setValue(threadTarget, entry)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(outsider.inspectKeys([{ target: threadTarget, keys: [entry.key] }]))
      .rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
    await expect(coach.setValue({ ...threadTarget, entityId: 'missing' }, entry)).rejects.toThrow('FLEX_ENTITY_FORBIDDEN');
  });

  it('reports a malformed shared definition even without a value on the target', async () => {
    const { db, entity, coach } = await fixture();
    const key = 'discussion_category_selection';
    await db.flexAttributes.add({ id: flexAttributeId(entity.realmId, key), realmId: entity.realmId,
      owner: entity.realmId, key: 'wrong_definition_key', valueType: 'string' });
    expect(await coach.getThreadOrganization(entity)).toMatchObject({
      category: 'uncategorized', diagnostics: ['SHARED_ASSIGNMENT_INVALID'],
    });
  });

  it('distinguishes an unassigned peer from missing metadata and preserves access errors', async () => {
    const { db, scope, entity, free, coach, client, otherClient } = await fixture();
    await coach.assignThread(free, 'personal');
    const key = await discussionThreadAssignmentKey(entity);
    const attributeId = flexAttributeId(scope(0).realmId, key);
    const valueId = flexValueId(target('tg:11', scope(0).realmId), attributeId);
    const flex = new FlexAttributesRepository(db, 'tg:11');
    await flex.setValue(target('tg:11', scope(0).realmId), { key, valueType: 'string', value: 'nutrition' });
    expect(await client.getThreadOrganization(entity)).toMatchObject({ category: 'nutrition', diagnostics: [] });
    await db.flexValues.update(valueId, { value: 'invalid-category' });
    const result = await coach.classifyThreads([entity, free]);
    expect(result.threads.map(row => row.category)).toEqual(['training', 'personal']);
    expect(result.threads[0].diagnostics).toContain('OWN_ASSIGNMENT_INVALID');
    await db.flexValues.update(valueId, { value: 'nutrition' });
    await db.flexAttributes.delete(attributeId);
    expect((await client.getThreadOrganization(entity)).diagnostics).toContain('PEER_ASSIGNMENT_PENDING');
    await db.flexAttributes.add({ id: attributeId, realmId: scope(0).realmId,
      owner: scope(0).realmId, key, valueType: 'string' });
    expect((await client.getThreadOrganization(entity)).category).toBe('nutrition');
    await new FlexAttributesRepository(db, 'tg:22').setValue(target('tg:22', scope(0).realmId),
      { key, valueType: 'string', value: 'personal' });
    for (const repository of [coach, client]) {
      expect(await repository.getThreadOrganization(entity)).toMatchObject({
        category: 'uncategorized', diagnostics: ['LEGACY_BASIC_ASSIGNMENT_CONFLICT'],
      });
    }
    const ownCategory = await client.createCategory('Повреждённая');
    await client.assignThread(free, { kind: 'custom', id: ownCategory.id });
    await db.flexValues.update(flexValueId(target('tg:22'),
      flexAttributeId('tg:22', discussionCategoryKey(ownCategory.id))), { value: 'invalid JSON' });
    const fallback = await client.getThreadOrganization(free);
    expect(fallback.category).toBe('uncategorized');
    expect(fallback.diagnostics).toContain('OWN_ASSIGNMENT_INVALID_OR_STALE');
    expect((await client.readCategories()).diagnostics.length).toBeGreaterThan(0);
    await expect(otherClient.classifyThreads([entity])).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  });

  it('clears matching links for both sides while keeping other shared selections intact', async () => {
    const { db, scope, entity, other, personal, coach, client, otherClient } = await fixture();
    const category = await coach.createCategory('Удаляемая');
    const privateFolder = await client.createCategory('Другой раздел');
    await coach.assignThread(entity, { kind: 'custom', id: category.id });
    await coach.assignThread(other, { kind: 'custom', id: category.id });
    const ownPersonal = await new DiscussionRepository(db, 'tg:11', { realmId: 'tg:11', coachClientId: null })
      .createThread(prepareDiscussionThread(anchor, 'Мой план', '2026-11-17'));
    await coach.assignThread(ownPersonal, { kind: 'custom', id: category.id });
    await client.assignThread(entity, { kind: 'custom', id: privateFolder.id });
    await coach.removeCategory(category.id);
    expect(await coach.listCategories()).toEqual([]);
    expect((await db.flexValues.get(flexValueId(target('tg:11'),
      flexAttributeId('tg:11', discussionCategoryKey(category.id)))))?.value).toBeNull();
    for (const thread of [entity, other, ownPersonal])
      expect((await coach.getThreadOrganization(thread)).category).toBe('uncategorized');
    expect((await client.getThreadOrganization(entity)).category).toBe('uncategorized');
    expect((await otherClient.getThreadOrganization(other)).category).toBe('uncategorized');
    expect(await client.listCategories()).toEqual([privateFolder]);
    const key = await discussionThreadAssignmentKey(entity);
    await new FlexAttributesRepository(db, 'tg:11').setValue(target('tg:11', scope(0).realmId),
      { key, valueType: 'string', value: 'custom:' + category.id });
    expect((await coach.getThreadOrganization(entity)).category).toBe('uncategorized');
    await coach.removeCategory(category.id); // repeat a tombstoned deletion after late hydration
    expect((await db.flexValues.get(flexValueId(target('tg:11', entity.realmId),
      flexAttributeId(entity.realmId, key))))?.value).toBeNull();
    expect((await client.getThreadOrganization(personal)).category).toBe('training');
  });

  it('cleans a pending value whose definition is not yet hydrated before the category tombstone', async () => {
    const { db, entity, coach } = await fixture();
    const category = await coach.createCategory('Ожидающий метаданные раздел');
    const key = await discussionThreadAssignmentKey(entity);
    const attributeId = flexAttributeId(entity.realmId, key);
    const valueId = flexValueId(target('tg:11', entity.realmId), attributeId);
    await new FlexAttributesRepository(db, 'tg:11').setValue(target('tg:11', entity.realmId),
      { key, valueType: 'string', value: 'custom:' + category.id });
    await db.flexAttributes.delete(attributeId); // only in test: imitate Addon value-first hydration
    expect((await db.flexValues.get(valueId))?.value).toBe('custom:' + category.id);
    await coach.removeCategory(category.id);
    expect((await db.flexAttributes.get(attributeId))?.valueType).toBe('string');
    expect((await db.flexValues.get(valueId))?.value).toBeNull();
    expect(await coach.listCategories()).toEqual([]);
    expect((await coach.getThreadOrganization(entity)).category).toBe('uncategorized');
  });

  it('removes a folder when a shared definition has no actor value', async () => {
    const { db, entity, coach } = await fixture();
    const category = await coach.createCategory('Нет собственного назначения');
    const key = await discussionThreadAssignmentKey(entity);
    const attributeId = flexAttributeId(entity.realmId, key);
    await db.flexAttributes.add({ id: attributeId, realmId: entity.realmId, owner: entity.realmId,
      key, valueType: 'string' });
    expect((await coach.getThreadOrganization(entity)).diagnostics).toEqual([]);
    await coach.removeCategory(category.id);
    expect(await coach.listCategories()).toEqual([]);
  });

  it('removes a category even when an unrelated thread has only the peer assignment', async () => {
    const { entity, free, coach, client } = await fixture();
    const category = await coach.createCategory('Разбор');
    await coach.assignThread(free, { kind: 'custom', id: category.id });
    await client.assignThread(entity, 'nutrition');

    await coach.removeCategory(category.id);

    expect(await coach.listCategories()).toEqual([]);
    expect((await coach.getThreadOrganization(free)).ownAssignment).toBeNull();
    expect((await coach.getThreadOrganization(entity)).category).toBe('nutrition');
    expect((await client.getThreadOrganization(entity)).category).toBe('nutrition');
  });

  it('rolls back cleared links after a realm failure and supports retry', async () => {
    const { entity, other, coach } = await fixture();
    const category = await coach.createCategory('Повторить');
    await coach.assignThread(entity, { kind: 'custom', id: category.id });
    await coach.assignThread(other, { kind: 'custom', id: category.id });
    const setValues = FlexAttributesRepository.prototype.setValues;
    const spy = vi.spyOn(FlexAttributesRepository.prototype, 'setValues')
      .mockImplementationOnce(function (this: typeof FlexAttributesRepository.prototype, target, entries) {
        return setValues.call(this, target, entries);
      })
      .mockRejectedValueOnce(new Error('SIMULATED_REALM_FAILURE'));
    await expect(coach.removeCategory(category.id)).rejects.toThrow('SIMULATED_REALM_FAILURE');
    spy.mockRestore();
    expect((await coach.listCategories()).map(item => item.id)).toContain(category.id);
    expect((await coach.getThreadOrganization(entity)).ownAssignment).toBe('custom:' + category.id);
    expect((await coach.getThreadOrganization(other)).ownAssignment).toBe('custom:' + category.id);
    await coach.removeCategory(category.id);
    expect(await coach.listCategories()).toEqual([]);
  });

  it('exposes a single reactive subscription for category and feed projections', async () => {
    const { coach, entity } = await fixture();
    const categories: number[] = [], assignments: string[] = [];
    const categorySub = coach.observeCategories(value => categories.push(value.categories.length), error => { throw error; });
    const feedSub = coach.observe([entity], result => {
      const value = result.threads[0]?.category;
      if (typeof value === 'string') assignments.push(value);
    }, error => { throw error; });
    try {
      await vi.waitFor(() => expect(categories).toContain(0));
      await vi.waitFor(() => expect(assignments).toContain('training'));
      await coach.createCategory('Реактивная');
      await vi.waitFor(() => expect(categories).toContain(1));
      await coach.assignThread(entity, 'nutrition');
      await vi.waitFor(() => expect(assignments).toContain('nutrition'));
    } finally { categorySub.unsubscribe(); feedSub.unsubscribe(); }
  });
});


it('keeps a deleted chat readable for its peer and blocks publication transactionally', async () => {
  const { db, scope, entity, free } = await fixture();
  const coach = new DiscussionRepository(db, 'tg:11', scope(0));
  const client = new DiscussionRepository(db, 'tg:22', scope(0));
  const message = await client.send(prepareDiscussionMessage(free.id, 'Сохранённый текст'));
  const coachMessage = await coach.send({ ...prepareDiscussionMessage(free.id, 'Ответ'),
    createdAt: new Date(Date.parse(message.createdAt) + 1).toISOString() });
  const draft = prepareDiscussionMessage(free.id, 'Черновик');
  await client.saveDraft(draft);
  const outsider = new DiscussionRepository(db, 'tg:44', scope(0));
  await expect(outsider.deleteFreeDiscussion(free.id)).rejects.toThrow('DISCUSSION_ACCESS_DENIED');
  await expect(coach.deleteFreeDiscussion(entity.id)).rejects.toThrow('DISCUSSION_CANNOT_BE_DELETED');
  const deletions: Array<'actor' | 'peer' | undefined> = [];
  const subscription = client.observePage(free.id, page => deletions.push(page.deletion), error => { throw error; });
  try {
    await vi.waitFor(() => expect(deletions).toContain(undefined));
    expect(await coach.unread(free.id)).toBe(1);
    await coach.deleteFreeDiscussion(free.id);
    await coach.deleteFreeDiscussion(free.id);
    await vi.waitFor(() => expect(deletions).toContain('peer'));
    expect(await coach.unread(free.id)).toBe(0);
    expect(await coach.listThreads(free.anchor)).toEqual([]);
    expect((await coach.feed()).map(row => row.thread.id)).not.toContain(free.id);
    await expect(coach.getThread(free.id)).rejects.toThrow('DISCUSSION_NOT_FOUND');
    await expect(coach.getMessage(free.id, message.id)).rejects.toThrow('DISCUSSION_MESSAGE_NOT_FOUND');
    await expect(readDiscussionNotificationThread(db, 'tg:11', message.id, new Set([free.realmId]))).resolves.toBeNull();
    await expect(readDiscussionNotificationThread(db, 'tg:22', coachMessage.id, new Set([free.realmId]))).resolves.toMatchObject({ id: free.id });
    expect(await client.getDraft(free.id)).toBeNull();
    await expect(client.send(draft)).rejects.toThrow('DISCUSSION_READ_ONLY');
    await expect(coach.send(prepareDiscussionMessage(free.id, 'Новый текст'))).rejects.toThrow('DISCUSSION_READ_ONLY');
    await expect(client.saveDraft(draft)).rejects.toThrow('DISCUSSION_READ_ONLY');
    await expect(client.edit(free.id, message.id, 'Изменение')).rejects.toThrow('DISCUSSION_READ_ONLY');
    await expect(client.remove(free.id, message.id)).rejects.toThrow('DISCUSSION_READ_ONLY');
    expect((await client.page(free.id)).messages.map(row => row.text)).toEqual(['Сохранённый текст', 'Ответ']);
    expect((await client.feed()).map(row => row.thread.id)).toContain(free.id);
    await client.markRead(free.id, coachMessage.id);
    expect(await client.unread(free.id)).toBe(0);
  } finally { subscription.unsubscribe(); }
});
