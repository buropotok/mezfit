import { liveQuery } from 'dexie';
import type Dexie from 'dexie';
import { discussionId } from '../../../shared/discussion-anchor';
import { flexAttributeId, flexValueId } from '../../../shared/flex-identifiers';
import { assertDiscussionThread, type DiscussionThread } from './discussion-contracts';
import { FlexAttributesRepository, type FlexEntityTarget, type FlexInspectedValue } from './flex-attributes';
import { profileRelationships } from './user-profile-relationships';
import type { MezfitCloudDatabase } from './database';

/**
 * Personal category names and order never leave the actor's user realm.
 * The relationship realm only contains an opaque, per-actor classification code.
 * Flex metadata is presentation-only and never grants discussion access.
 */
type OrganizationDatabase = Dexie & Pick<MezfitCloudDatabase,
  'flexAttributes' | 'flexValues' | 'adHocSessions' | 'realms' | 'members' | 'discussionThreads'>;
export type CategoryId = string & { readonly __discussionCategoryId: unique symbol };
export interface CategoryDefinition { id: CategoryId; name: string; order: number }
export type ThreadAssignment = 'nutrition' | 'personal' | `custom:${CategoryId}`;
export type AssignableDiscussionCategory = 'nutrition' | 'personal' | { kind: 'custom'; id: CategoryId };
export type ResolvedDiscussionCategory = 'training' | 'nutrition' | 'personal' | 'coach' | 'client'
  | { kind: 'custom'; id: CategoryId };
export interface DiscussionCategorySnapshot { categories: CategoryDefinition[]; diagnostics: string[] }
export interface OrganizedDiscussionThread {
  thread: DiscussionThread;
  category: ResolvedDiscussionCategory;
  ownAssignment: ThreadAssignment | null;
  peerCategorized: boolean;
  diagnostics: string[];
}
export interface DiscussionOrganizationSnapshot extends DiscussionCategorySnapshot {
  threads: OrganizedDiscussionThread[];
}

export const DISCUSSION_SYSTEM_CATEGORIES = {
  training: 'Тренировки', nutrition: 'Питание', personal: 'Личное',
  coach: 'Тренерские', client: 'Клиентские',
} as const;
export const DISCUSSION_CATEGORY_NAME_MAX_LENGTH = 48;
export const DISCUSSION_CATEGORY_KEY_PREFIX = 'discussion_group_';
export const DISCUSSION_ASSIGNMENT_KEY_PREFIX = 'discussion_thread_';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reservedNames = new Set(Object.values(DISCUSSION_SYSTEM_CATEGORIES).map(name => name.toLocaleLowerCase('ru-RU')));
const categoryName = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('INVALID_DISCUSSION_CATEGORY_NAME');
  const trimmed = value.trim().normalize('NFC');
  if (!trimmed || [...trimmed].length > DISCUSSION_CATEGORY_NAME_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(trimmed)
    || reservedNames.has(trimmed.toLocaleLowerCase('ru-RU')) || trimmed === '+')
    throw new Error('INVALID_DISCUSSION_CATEGORY_NAME');
  return trimmed;
};
const sameName = (name: string) => name.normalize('NFC').toLocaleLowerCase('ru-RU');

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && uuidPattern.test(value);
}
export function discussionCategoryKey(id: CategoryId): string {
  if (!isCategoryId(id)) throw new Error('INVALID_DISCUSSION_CATEGORY_ID');
  return DISCUSSION_CATEGORY_KEY_PREFIX + id.replaceAll('-', '');
}
function idFromCategoryKey(key: string): CategoryId | null {
  if (!key.startsWith(DISCUSSION_CATEGORY_KEY_PREFIX)) return null;
  const hex = key.slice(DISCUSSION_CATEGORY_KEY_PREFIX.length);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return isCategoryId(id) ? id : null;
}
/** A SHA-256 domain-separated 160-bit prefix: 58 ASCII key characters. */
export async function discussionThreadAssignmentKey(thread: Pick<DiscussionThread, 'realmId' | 'id'>): Promise<string> {
  if (!discussionId(thread.realmId) || !discussionId(thread.id)) throw new Error('INVALID_DISCUSSION_ID');
  const source = JSON.stringify(['mezfit/discussion-organization/thread/v1', thread.realmId, thread.id]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = [...new Uint8Array(hash)].slice(0, 20).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return DISCUSSION_ASSIGNMENT_KEY_PREFIX + hex;
}
export function encodeCategoryDefinition(category: CategoryDefinition): string {
  if (!isCategoryId(category.id) || !Number.isSafeInteger(category.order) || category.order < 0)
    throw new Error('INVALID_DISCUSSION_CATEGORY');
  const encoded = JSON.stringify({ v: 1, name: categoryName(category.name), order: category.order });
  if (encoded.length > 512) throw new Error('INVALID_DISCUSSION_CATEGORY');
  return encoded;
}
export function decodeCategoryDefinition(key: string, value: unknown): CategoryDefinition | null {
  const id = idFromCategoryKey(key);
  if (!id || typeof value !== 'string' || value.length > 512) return null;
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const record = data as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'name,order,v' || record.v !== 1
      || !Number.isSafeInteger(record.order) || (record.order as number) < 0) return null;
    const name = categoryName(record.name);
    if (name !== record.name) return null;
    return { id, name, order: record.order as number };
  } catch { return null; }
}
export function decodeThreadAssignment(value: unknown): ThreadAssignment | null {
  if (value === 'nutrition' || value === 'personal') return value;
  if (typeof value === 'string' && value.startsWith('custom:')
    && isCategoryId(value.slice(7))) return value as ThreadAssignment;
  return null;
}
function encodeAssignment(category: AssignableDiscussionCategory): ThreadAssignment {
  if (category === 'nutrition' || category === 'personal') return category;
  if (category && typeof category === 'object' && category.kind === 'custom' && isCategoryId(category.id))
    return `custom:${category.id}`;
  throw new Error('INVALID_DISCUSSION_ASSIGNMENT');
}
function lookup(target: FlexEntityTarget, key: string): string {
  return flexValueId(target, flexAttributeId(target.realmId, key));
}
function categoryOrder(a: CategoryDefinition, b: CategoryDefinition): number {
  return a.order - b.order || a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id);
}
/** Pure deterministic precedence; untrusted assignment validation occurs at the repository boundary. */
export function resolveDiscussionCategory(
  kind: DiscussionThread['anchor']['kind'],
  own: ThreadAssignment | null, peer: ThreadAssignment | null, peerRole: 'coach' | 'client' | null,
): ResolvedDiscussionCategory {
  if (own) return own.startsWith('custom:') ? { kind: 'custom', id: own.slice(7) as CategoryId } : own as 'nutrition' | 'personal';
  if (peer && peerRole) return peerRole;
  return kind === 'free' ? 'personal' : 'training';
}

/** All authorization is checked against current locally available relationship membership. */
export class DiscussionOrganizationRepository<TDatabase extends OrganizationDatabase = MezfitCloudDatabase> {
  private readonly flex: FlexAttributesRepository<TDatabase>;
  private readonly personal: FlexEntityTarget;
  constructor(private readonly db: TDatabase, readonly actorUserId: string) {
    this.flex = new FlexAttributesRepository(db, actorUserId);
    this.personal = { entityType: 'user', entityId: actorUserId, realmId: actorUserId };
  }
  private personalTables() { return [this.db.flexAttributes, this.db.flexValues, this.db.adHocSessions]; }
  private async categorySnapshot(): Promise<DiscussionCategorySnapshot> {
    const records = await this.flex.inspectPrefix([this.personal], DISCUSSION_CATEGORY_KEY_PREFIX);
    const categories: CategoryDefinition[] = [], diagnostics: string[] = [];
    const names = new Set<string>();
    for (const record of records.sort((a, b) => a.key.localeCompare(b.key))) {
      if (record.state === 'pending') { diagnostics.push('CATEGORY_PENDING:' + record.key); continue; }
      if (record.state !== 'present' || record.valueType !== 'string') {
        diagnostics.push('CATEGORY_INVALID:' + record.key); continue;
      }
      if (record.value === null) continue; // Add-only definition, tombstoned value.
      const category = decodeCategoryDefinition(record.key, record.value);
      if (!category || names.has(sameName(category.name))) {
        diagnostics.push('CATEGORY_INVALID_OR_DUPLICATE:' + record.key); continue;
      }
      names.add(sameName(category.name)); categories.push(category);
    }
    return { categories: categories.sort(categoryOrder), diagnostics };
  }
  async readCategories(): Promise<DiscussionCategorySnapshot> { return this.categorySnapshot(); }
  async listCategories(): Promise<CategoryDefinition[]> { return (await this.categorySnapshot()).categories; }
  observeCategories(next: (value: DiscussionCategorySnapshot) => void, error: (reason: unknown) => void) {
    return liveQuery(() => this.readCategories()).subscribe({ next, error });
  }
  private async modifyCategories<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', this.personalTables(), work);
  }
  async createCategory(name: string): Promise<CategoryDefinition> {
    const validName = categoryName(name);
    const id = crypto.randomUUID() as CategoryId;
    return this.modifyCategories(async () => {
      const existing = await this.listCategories();
      if (existing.some(category => sameName(category.name) === sameName(validName)))
        throw new Error('DUPLICATE_DISCUSSION_CATEGORY_NAME');
      const category = { id, name: validName, order: existing.reduce((max, entry) => Math.max(max, entry.order), -1) + 1 };
      await this.flex.setValue(this.personal, { key: discussionCategoryKey(id), valueType: 'string',
        value: encodeCategoryDefinition(category) });
      return category;
    });
  }
  async renameCategory(id: CategoryId, name: string): Promise<void> {
    const validName = categoryName(name);
    await this.modifyCategories(async () => {
      const categories = await this.listCategories();
      const previous = categories.find(category => category.id === id);
      if (!previous) throw new Error('DISCUSSION_CATEGORY_NOT_FOUND');
      if (categories.some(category => category.id !== id && sameName(category.name) === sameName(validName)))
        throw new Error('DUPLICATE_DISCUSSION_CATEGORY_NAME');
      await this.flex.setValue(this.personal, { key: discussionCategoryKey(id), valueType: 'string',
        value: encodeCategoryDefinition({ ...previous, name: validName }) });
    });
  }
  async reorderCategories(ids: readonly CategoryId[]): Promise<void> {
    await this.modifyCategories(async () => {
      const categories = await this.listCategories();
      if (!Array.isArray(ids) || ids.length !== categories.length || new Set(ids).size !== ids.length
        || ids.some(id => !categories.some(category => category.id === id)))
        throw new Error('INVALID_DISCUSSION_CATEGORY_ORDER');
      const byId = new Map(categories.map(category => [category.id, category]));
      await this.flex.setValues(this.personal, ids.map((id, order) => {
        const category = byId.get(id);
        if (!category) throw new Error('INVALID_DISCUSSION_CATEGORY_ORDER');
        return { key: discussionCategoryKey(id), valueType: 'string' as const,
          value: encodeCategoryDefinition({ ...category, order }) };
      }));
    });
  }
  private sharedTarget(realmId: string, userId: string): FlexEntityTarget {
    return { entityType: 'publishedUser', entityId: userId, realmId };
  }
  private async checkedThreads(threads: readonly DiscussionThread[]) {
    for (const thread of threads) {
      if (!thread || typeof thread !== 'object' || !discussionId(thread.id))
        throw new Error('INVALID_DISCUSSION_THREAD');
      assertDiscussionThread(thread);
    }
    const stored = await this.db.discussionThreads.bulkGet(threads.map(thread => thread.id));
    const pairs = threads.some(thread => thread.coachClientId !== null)
      ? await profileRelationships(this.db, this.actorUserId) : [];
    const byRealm = new Map(pairs.map(pair => [pair.realmId, pair]));
    for (let index = 0; index < threads.length; index++) {
      const thread = threads[index], persisted = stored[index];
      assertDiscussionThread(thread);
      if (!persisted) throw new Error('DISCUSSION_NOT_FOUND');
      assertDiscussionThread(persisted);
      if (persisted.id !== thread.id || persisted.realmId !== thread.realmId
        || persisted.coachClientId !== thread.coachClientId || persisted.anchorKey !== thread.anchorKey
        || persisted.createdAt !== thread.createdAt
        || persisted.derivedTitleSnapshot !== thread.derivedTitleSnapshot)
        throw new Error('DISCUSSION_NOT_FOUND');
      if (thread.coachClientId === null) {
        if (thread.realmId !== this.actorUserId) throw new Error('DISCUSSION_ACCESS_DENIED');
      } else if (thread.coachClientId !== thread.realmId || !byRealm.has(thread.realmId))
        throw new Error('DISCUSSION_ACCESS_DENIED');
    }
    return byRealm;
  }
  private async checkedThread(thread: DiscussionThread): Promise<void> {
    await this.checkedThreads([thread]);
  }
  private async assignmentTarget(thread: DiscussionThread): Promise<FlexEntityTarget> {
    await this.checkedThread(thread);
    return thread.coachClientId === null ? this.personal : this.sharedTarget(thread.realmId, this.actorUserId);
  }
  async assignThread(thread: DiscussionThread, category: AssignableDiscussionCategory): Promise<void> {
    const code = encodeAssignment(category);
    if (code.startsWith('custom:') && !(await this.listCategories()).some(row => row.id === code.slice(7)))
      throw new Error('DISCUSSION_CATEGORY_NOT_FOUND');
    const target = await this.assignmentTarget(thread);
    const key = await discussionThreadAssignmentKey(thread);
    await this.flex.setValue(target, { key, valueType: 'string', value: code });
  }
  async clearThreadAssignment(thread: DiscussionThread): Promise<void> {
    const target = await this.assignmentTarget(thread);
    const key = await discussionThreadAssignmentKey(thread);
    await this.flex.clearValue(target, key, 'string');
  }
  async getThreadOrganization(thread: DiscussionThread): Promise<OrganizedDiscussionThread> {
    const snapshot = await this.classifyThreads([thread]);
    const resolved = snapshot.threads[0];
    if (!resolved) throw new Error('DISCUSSION_NOT_FOUND');
    return resolved;
  }
  /** Bounded, per-realm verification and batched Flex inspection independent of thread count. */
  async classifyThreads(threads: readonly DiscussionThread[]): Promise<DiscussionOrganizationSnapshot> {
    if (!Array.isArray(threads) || threads.some(thread => !thread || typeof thread !== 'object'
      || !discussionId(thread.id))) throw new Error('INVALID_DISCUSSION_THREAD');
    const unique = [...new Map(threads.map(thread => [thread.id, thread])).values()];
    const [categories, realms, keys] = await Promise.all([
      this.readCategories(), this.checkedThreads(unique),
      Promise.all(unique.map(thread => discussionThreadAssignmentKey(thread))),
    ]);
    const activeIds = new Set(categories.categories.map(category => category.id));
    const requests = new Map<string, { target: FlexEntityTarget; keys: string[] }>();
    const add = (target: FlexEntityTarget, key: string) => {
      const token = JSON.stringify([target.realmId, target.entityType, target.entityId]);
      let request = requests.get(token);
      if (!request) { request = { target, keys: [] }; requests.set(token, request); }
      request.keys.push(key);
    };
    unique.forEach((thread, index) => {
      const key = keys[index];
      add(thread.coachClientId === null ? this.personal : this.sharedTarget(thread.realmId, this.actorUserId), key);
      if (thread.coachClientId !== null) {
        const pair = realms.get(thread.realmId);
        if (!pair) throw new Error('DISCUSSION_ACCESS_DENIED');
        const peerId = pair.coachUserId === this.actorUserId ? pair.clientUserId : pair.coachUserId;
        add(this.sharedTarget(thread.realmId, peerId), key);
      }
    });
    const inspected = await this.flex.inspectKeys([...requests.values()]);
    const byKey = new Map(inspected.map(record => [lookup(record.target, record.key), record]));
    const decode = (record: FlexInspectedValue | undefined, own: boolean, diagnostics: string[]): ThreadAssignment | null => {
      if (!record || record.state === 'absent' || (record.state === 'present' && record.value === null)) return null;
      if (record.state !== 'present' || record.valueType !== 'string') {
        diagnostics.push((own ? 'OWN_' : 'PEER_') + 'ASSIGNMENT_' + (record.state === 'pending' ? 'PENDING' : 'INVALID'));
        return null;
      }
      const code = decodeThreadAssignment(record.value);
      if (!code || (own && code.startsWith('custom:') && !activeIds.has(code.slice(7) as CategoryId))) {
        diagnostics.push((own ? 'OWN_' : 'PEER_') + 'ASSIGNMENT_INVALID_OR_STALE');
        return null;
      }
      return code;
    };
    const result = unique.map((thread, index): OrganizedDiscussionThread => {
      const diagnostics: string[] = [];
      const key = keys[index];
      const ownTarget = thread.coachClientId === null ? this.personal : this.sharedTarget(thread.realmId, this.actorUserId);
      const own = decode(byKey.get(lookup(ownTarget, key)), true, diagnostics);
      let peer: ThreadAssignment | null = null, peerRole: 'coach' | 'client' | null = null;
      if (thread.coachClientId !== null) {
        const pair = realms.get(thread.realmId);
        if (!pair) throw new Error('DISCUSSION_ACCESS_DENIED');
        const peerId = pair.coachUserId === this.actorUserId ? pair.clientUserId : pair.coachUserId;
        peerRole = peerId === pair.coachUserId ? 'coach' : 'client';
        peer = decode(byKey.get(lookup(this.sharedTarget(thread.realmId, peerId), key)), false, diagnostics);
      }
      return { thread, category: resolveDiscussionCategory(thread.anchor.kind, own, peer, peerRole),
        ownAssignment: own, peerCategorized: peer !== null, diagnostics };
    });
    return { ...categories, threads: result };
  }
  observe(threads: readonly DiscussionThread[], next: (value: DiscussionOrganizationSnapshot) => void,
    error: (reason: unknown) => void) {
    return liveQuery(() => this.classifyThreads(threads)).subscribe({ next, error });
  }

  /** Clear every locally accessible own assignment first; only then tombstone the category.
   * A failed realm write leaves the category active for explicit retry. No peer target is written. */
  async removeCategory(id: CategoryId): Promise<void> {
    const key = discussionCategoryKey(id);
    const existing = await this.flex.inspectKeys([{ target: this.personal, keys: [key] }]);
    const record = existing[0];
    if (!record || record.state === 'absent') throw new Error('DISCUSSION_CATEGORY_NOT_FOUND');
    if (record.state !== 'present' || record.valueType !== 'string'
      || (record.value !== null && !decodeCategoryDefinition(key, record.value)))
      throw new Error('INVALID_DISCUSSION_CATEGORY');
    const pairs = await profileRelationships(this.db, this.actorUserId);
    const targets = [this.personal, ...pairs.map(pair => this.sharedTarget(pair.realmId, this.actorUserId))];
    const code = 'custom:' + id;
    const find = async () => this.flex.inspectPrefix(targets, DISCUSSION_ASSIGNMENT_KEY_PREFIX);
    const inspect = await find();
    if (inspect.some(item => (item.state === 'pending' && item.value === undefined)
      || (item.state === 'invalid' && item.value === code)))
      throw new Error('DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE');
    const byTarget = new Map<string, { target: FlexEntityTarget; keys: string[] }>();
    for (const item of inspect) {
      if ((item.state !== 'present' && item.state !== 'pending') || item.value !== code) continue;
      const token = JSON.stringify([item.target.realmId, item.target.entityType, item.target.entityId]);
      let batch = byTarget.get(token);
      if (!batch) { batch = { target: item.target, keys: [] }; byTarget.set(token, batch); }
      batch.keys.push(item.key);
    }
    for (const { target, keys } of byTarget.values()) {
      await this.flex.setValues(target, keys.map(assignmentKey =>
        ({ key: assignmentKey, valueType: 'string' as const, value: null })));
    }
    const remaining = await find();
    if (remaining.some(item => (item.state === 'pending' && item.value === undefined)
      || (item.value === code && item.state !== 'absent')))
      throw new Error('DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE');
    await this.flex.clearValue(this.personal, key, 'string');
  }
}
