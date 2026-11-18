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
 * The relationship realm only contains the selected base and opaque folder IDs.
 * Flex metadata is presentation-only and never grants discussion access.
 */
type OrganizationDatabase = Dexie & Pick<MezfitCloudDatabase,
  'flexAttributes' | 'flexValues' | 'adHocSessions' | 'realms' | 'members' | 'discussionThreads'>;
export type CategoryId = string & { readonly __discussionCategoryId: unique symbol };
export interface CategoryDefinition { id: CategoryId; name: string; order: number }
type BasicCategory = 'training' | 'nutrition' | 'personal';
export type ThreadAssignment = BasicCategory | `custom:${CategoryId}`;
export type AssignableDiscussionCategory = BasicCategory | { kind: 'custom'; id: CategoryId };
export type ResolvedDiscussionCategory = BasicCategory | 'uncategorized' | 'coach' | 'client'
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
  all: 'Все чаты', training: 'Тренировки', nutrition: 'Питание', personal: 'Личное',
  coach: 'Тренерские', client: 'Клиентские',
} as const;
export const DISCUSSION_CATEGORY_NAME_MAX_LENGTH = 48;
export const DISCUSSION_CATEGORY_KEY_PREFIX = 'discussion_group_';
export const DISCUSSION_ASSIGNMENT_KEY_PREFIX = 'discussion_thread_';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reservedNames = new Set([...Object.values(DISCUSSION_SYSTEM_CATEGORIES), 'Без категории']
  .map(name => name.toLocaleLowerCase('ru-RU')));
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
  if (value === 'personal' || value === 'nutrition') return value;
  if (typeof value === 'string' && value.startsWith('custom:')
    && isCategoryId(value.slice(7))) return value as ThreadAssignment;
  return null;
}
function isBasicCategory(value: unknown): value is BasicCategory {
  return value === 'training' || value === 'nutrition' || value === 'personal';
}

type CategoryOwner = 'coach' | 'client' | 'personal';
type CategorySelection = { v: 1; base: BasicCategory | 'none' } & Partial<Record<CategoryOwner, CategoryId>>;
const sharedAssignmentKey = 'discussion_category_selection';
const emptySelection: CategorySelection = { v: 1, base: 'none' };

function decodeSelection(value: unknown): CategorySelection | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (row.v !== 1 || (!isBasicCategory(row.base) && row.base !== 'none')) return null;
    const result: CategorySelection = { v: 1, base: row.base };
    for (const [entry, id] of Object.entries(row)) {
      if (entry === 'v' || entry === 'base') continue;
      if ((entry !== 'coach' && entry !== 'client' && entry !== 'personal') || !isCategoryId(id)) return null;
      result[entry] = id;
    }
    return result;
  } catch { return null; }
}

function assignmentCategoryId(value: ThreadAssignment | null): CategoryId | undefined {
  if (!value?.startsWith('custom:')) return undefined;
  const id = value.slice(7);
  return isCategoryId(id) ? id : undefined;
}

function threadTarget(thread: DiscussionThread): FlexEntityTarget {
  return { entityType: 'discussionThread', entityId: thread.id, realmId: thread.realmId };
}

function assignmentAbsent(record: FlexInspectedValue | undefined): boolean {
  return !record || record.state === 'absent'
    || (record.state === 'pending' && !Object.hasOwn(record, 'value'))
    || (record.state === 'present' && record.value === null);
}

function lookup(target: FlexEntityTarget, key: string): string {
  return flexValueId(target, flexAttributeId(target.realmId, key));
}
function categoryOrder(a: CategoryDefinition, b: CategoryDefinition): number {
  return a.order - b.order || a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id);
}
const organizationCodes: Readonly<Record<string, number>> = {
  OBSERVATION_FAILED: 31, PROJECTION_INVALID: 32,
  CATEGORY_PENDING: 33, CATEGORY_INVALID: 34, CATEGORY_DEFINITION_INVALID: 35, CATEGORY_DUPLICATE: 45,
  OWN_ASSIGNMENT_PENDING: 36, OWN_ASSIGNMENT_INVALID: 37, OWN_ASSIGNMENT_INVALID_OR_STALE: 38,
  PEER_ASSIGNMENT_PENDING: 39, PEER_ASSIGNMENT_INVALID: 40,
  SHARED_ASSIGNMENT_PENDING: 41, SHARED_ASSIGNMENT_INVALID: 42, LEGACY_BASIC_ASSIGNMENT_CONFLICT: 43,
};

export function discussionOrganizationCode(diagnostic: string): number {
  const key = diagnostic.split(':', 1)[0];
  return Object.hasOwn(organizationCodes, key) ? organizationCodes[key] : 44;
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
    const records = await this.flex.inspectPrefix([this.personal], DISCUSSION_CATEGORY_KEY_PREFIX, DISCUSSION_CATEGORY_KEY_PREFIX.length + 32);
    const categories: CategoryDefinition[] = [], diagnostics: string[] = [];
    const names = new Set<string>();
    for (const record of records.sort((a, b) => a.key.localeCompare(b.key))) {
      if (record.state === 'pending') { diagnostics.push('CATEGORY_PENDING:' + record.key); continue; }
      if (record.state !== 'present' || record.valueType !== 'string') {
        diagnostics.push('CATEGORY_INVALID:' + record.key); continue;
      }
      if (record.value === null) continue; // Add-only definition, tombstoned value.
      const category = decodeCategoryDefinition(record.key, record.value);
      if (!category) { diagnostics.push('CATEGORY_DEFINITION_INVALID:' + record.key); continue; }
      if (names.has(sameName(category.name))) { diagnostics.push('CATEGORY_DUPLICATE:' + record.key); continue; }
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
  private async writableCategories(): Promise<CategoryDefinition[]> {
    const snapshot = await this.readCategories();
    if (snapshot.diagnostics.some(code => code.startsWith('CATEGORY_PENDING:')))
      throw new Error('DISCUSSION_CATEGORIES_INCOMPLETE');
    return snapshot.categories;
  }
  async createCategory(name: string): Promise<CategoryDefinition> {
    const validName = categoryName(name);
    const id = crypto.randomUUID() as CategoryId;
    return this.modifyCategories(async () => {
      const existing = await this.writableCategories();
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
      const categories = await this.writableCategories();
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
      const categories = await this.writableCategories();
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
  private assignmentTables() {
    return [...this.personalTables(), this.db.discussionThreads, this.db.realms, this.db.members];
  }
  private async writeThreadAssignment(thread: DiscussionThread, category: AssignableDiscussionCategory | null): Promise<void> {
    const key = await discussionThreadAssignmentKey(thread);
    await this.db.transaction('rw', this.assignmentTables(), async () => {
      const realms = await this.checkedThreads([thread]);
      let selection: CategorySelection;
      if (category === null || isBasicCategory(category)) {
        selection = { v: 1, base: category ?? 'none' };
      } else {
        if (category?.kind !== 'custom' || !isCategoryId(category.id)) throw new Error('INVALID_DISCUSSION_ASSIGNMENT');
        if (!(await this.listCategories()).some(entry => entry.id === category.id))
          throw new Error('DISCUSSION_CATEGORY_NOT_FOUND');
        const targets = this.assignmentTargets(thread, realms.get(thread.realmId), key);
        const records = await this.flex.inspectKeys(targets.requests);
        const byKey = new Map(records.map(record => [lookup(record.target, record.key), record]));
        const projected = this.readSelection(thread, targets, key, byKey);
        if (projected.diagnostics.some(code => code.endsWith('_PENDING')))
          throw new Error('DISCUSSION_CATEGORIES_INCOMPLETE');
        selection = { ...projected.selection, [targets.actorRole]: category.id };
      }
      await this.storeSelection(thread, selection);
    });
  }
  async assignThread(thread: DiscussionThread, category: AssignableDiscussionCategory): Promise<void> {
    await this.writeThreadAssignment(thread, category);
  }
  async clearThreadAssignment(thread: DiscussionThread): Promise<void> {
    await this.writeThreadAssignment(thread, null);
  }

  private storeSelection(thread: DiscussionThread, value: CategorySelection): Promise<void> {
    return this.flex.setValue(threadTarget(thread), { key: sharedAssignmentKey, valueType: 'string', value: JSON.stringify(value) });
  }

  private assignmentTargets(thread: DiscussionThread, pair: Awaited<ReturnType<typeof profileRelationships>>[number] | undefined,
    key: string) {
    if (thread.coachClientId !== null && !pair) throw new Error('DISCUSSION_ACCESS_DENIED');
    const own = pair ? this.sharedTarget(thread.realmId, this.actorUserId) : this.personal;
    const peer = pair ? this.sharedTarget(thread.realmId,
      pair.coachUserId === this.actorUserId ? pair.clientUserId : pair.coachUserId) : null;
    const actorRole: CategoryOwner = pair ? pair.coachUserId === this.actorUserId ? 'coach' : 'client' : 'personal';
    const peerRole = pair ? actorRole === 'coach' ? 'client' as const : 'coach' as const : null;
    const requests = [{ target: threadTarget(thread), keys: [sharedAssignmentKey] }, { target: own, keys: [key] }];
    if (peer) requests.push({ target: peer, keys: [key] });
    return { own, peer, actorRole, peerRole, requests };
  }

  private readSelection(thread: DiscussionThread, targets: ReturnType<DiscussionOrganizationRepository<TDatabase>['assignmentTargets']>,
    key: string, records: ReadonlyMap<string, FlexInspectedValue>) {
    const diagnostics: string[] = [];
    const canonical = records.get(lookup(threadTarget(thread), sharedAssignmentKey));
    if (canonical && !assignmentAbsent(canonical)) {
      const selection = canonical.state === 'present' && canonical.valueType === 'string' ? decodeSelection(canonical.value) : null;
      if (selection && (targets.peerRole ? !selection.personal : !selection.coach && !selection.client))
        return { selection, diagnostics };
      diagnostics.push(canonical.state === 'pending' ? 'SHARED_ASSIGNMENT_PENDING' : 'SHARED_ASSIGNMENT_INVALID');
      return { selection: emptySelection, diagnostics };
    }
    const decode = (target: FlexEntityTarget, origin: 'OWN' | 'PEER'): ThreadAssignment | null => {
      const record = records.get(lookup(target, key));
      if (!record || assignmentAbsent(record)) return null;
      if (record.state !== 'present' || record.valueType !== 'string') {
        diagnostics.push(origin + '_ASSIGNMENT_' + (record.state === 'pending' ? 'PENDING' : 'INVALID'));
        return null;
      }
      const value = decodeThreadAssignment(record.value);
      if (!value) diagnostics.push(origin + '_ASSIGNMENT_INVALID');
      return value;
    };
    const own = decode(targets.own, 'OWN');
    const peer = targets.peer ? decode(targets.peer, 'PEER') : null;
    const conflict = isBasicCategory(own) && isBasicCategory(peer) && own !== peer;
    if (conflict) diagnostics.push('LEGACY_BASIC_ASSIGNMENT_CONFLICT');
    const selection: CategorySelection = { v: 1, base: conflict ? 'none'
      : isBasicCategory(own) ? own : isBasicCategory(peer) ? peer : thread.anchor.kind === 'free' ? 'none' : 'training' };
    const ownCustom = assignmentCategoryId(own), peerCustom = assignmentCategoryId(peer);
    if (ownCustom) selection[targets.actorRole] = ownCustom;
    if (peerCustom && targets.peerRole) selection[targets.peerRole] = peerCustom;
    return { selection, diagnostics };
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
    const targets = unique.map((thread, index) => this.assignmentTargets(thread, realms.get(thread.realmId), keys[index]));
    const records = await this.flex.inspectKeys(targets.flatMap(entry => entry.requests));
    const byKey = new Map(records.map(record => [lookup(record.target, record.key), record]));
    const activeIds = new Set(categories.categories.map(category => category.id));
    const result = unique.map((thread, index): OrganizedDiscussionThread => {
      const { selection, diagnostics } = this.readSelection(thread, targets[index], keys[index], byKey);
      const { actorRole, peerRole } = targets[index];
      const own = selection[actorRole], peer = peerRole ? selection[peerRole] : undefined;
      if (own && !activeIds.has(own)) diagnostics.push('OWN_ASSIGNMENT_INVALID_OR_STALE');
      const category: ResolvedDiscussionCategory = own && activeIds.has(own) ? { kind: 'custom', id: own }
        : own ? 'uncategorized' : peer ? peerRole ?? 'uncategorized'
          : selection.base === 'none' ? 'uncategorized' : selection.base;
      return { thread, category, ownAssignment: own && activeIds.has(own) ? `custom:${own}`
        : selection.base === 'none' ? null : selection.base, peerCategorized: Boolean(peer), diagnostics };
    });
    return { ...categories, threads: result };
  }
  observe(threads: readonly DiscussionThread[], next: (value: DiscussionOrganizationSnapshot) => void,
    error: (reason: unknown) => void) {
    return liveQuery(() => this.classifyThreads(threads)).subscribe({ next, error });
  }

  /** Clear matching selections and tombstone the folder in one local transaction. */
  async removeCategory(id: CategoryId): Promise<void> {
    const key = discussionCategoryKey(id);
    const pairs = await profileRelationships(this.db, this.actorUserId);
    const visibleRealms = [...pairs.map(pair => pair.realmId), this.actorUserId];
    const legacy = await this.db.discussionThreads.where('realmId').anyOf(visibleRealms).toArray();
    const legacyKeys = new Map(await Promise.all(legacy.map(async thread =>
      [thread.id, await discussionThreadAssignmentKey(thread)] as const)));
    await this.db.transaction('rw', this.assignmentTables(), async () => {
      const [record] = await this.flex.inspectKeys([{ target: this.personal, keys: [key] }]);
      if (!record || record.state === 'absent') throw new Error('DISCUSSION_CATEGORY_NOT_FOUND');
      if (record.state !== 'present' || record.valueType !== 'string'
        || (record.value !== null && !decodeCategoryDefinition(key, record.value)))
        throw new Error('INVALID_DISCUSSION_CATEGORY');

      const currentPairs = await profileRelationships(this.db, this.actorUserId);
      const realms = new Map(currentPairs.map(pair => [pair.realmId, pair]));
      const threads = await this.db.discussionThreads.where('realmId')
        .anyOf([...realms.keys(), this.actorUserId]).toArray();
      const entries = threads.map(thread => {
        const legacyKey = legacyKeys.get(thread.id);
        if (!legacyKey) throw new Error('DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE');
        return { thread, legacyKey, targets: this.assignmentTargets(thread, realms.get(thread.realmId), legacyKey) };
      });
      const ownLegacyTargets = [this.personal,
        ...currentPairs.map(pair => this.sharedTarget(pair.realmId, this.actorUserId))];
      const ownLegacy = await this.flex.inspectPrefix(ownLegacyTargets,
        DISCUSSION_ASSIGNMENT_KEY_PREFIX, DISCUSSION_ASSIGNMENT_KEY_PREFIX.length + 40);
      const handled = new Set(entries.map(({ targets, legacyKey }) => lookup(targets.own, legacyKey)));
      if (ownLegacy.some(record => record.value === `custom:${id}`
        && !handled.has(lookup(record.target, record.key)))) throw new Error('DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE');
      const values = await this.flex.inspectKeys(entries.flatMap(entry => entry.targets.requests));
      const records = new Map(values.map(value => [lookup(value.target, value.key), value]));
      for (const { thread, legacyKey, targets } of entries) {
        const { selection, diagnostics } = this.readSelection(thread, targets, legacyKey, records);
        const legacyOwn = records.get(lookup(targets.own, legacyKey));
        const shared = records.get(lookup(threadTarget(thread), sharedAssignmentKey));
        const matchingLegacy = legacyOwn?.value === `custom:${id}` ? legacyOwn : undefined;
        if (diagnostics.includes('SHARED_ASSIGNMENT_PENDING') || diagnostics.includes('SHARED_ASSIGNMENT_INVALID')
          || (matchingLegacy && (matchingLegacy.state === 'invalid'
            || (matchingLegacy.state === 'present' && matchingLegacy.valueType !== 'string'))))
          throw new Error('DISCUSSION_CATEGORY_CLEANUP_INCOMPLETE');
        if (selection[targets.actorRole] === id || (matchingLegacy && assignmentAbsent(shared)))
          await this.storeSelection(thread, emptySelection);
        if (matchingLegacy)
          await this.flex.clearValue(targets.own, legacyKey, 'string');
      }
      await this.flex.clearValue(this.personal, key, 'string');
    });
  }
}
