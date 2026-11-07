// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { createCloudDatabase, MezfitCloudDatabase, CLOUD_DISCUSSION_DATABASE_VERSION } from './database';
vi.mock('./discussion-activation', () => ({ CLOUD_DISCUSSIONS_ENABLED: true }));
const databases: MezfitCloudDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) { db.close(); await db.delete(); }
});

it('registers the same discussion schema by default through every default account construction path', () => {
  const factory = createCloudDatabase('222001', 'signed-init');
  const direct = new MezfitCloudDatabase('222002', 'signed-init');
  databases.push(factory, direct);
  for (const db of databases) {
    expect(db.verno).toBe(CLOUD_DISCUSSION_DATABASE_VERSION);
    expect(db.discussionMessages.schema.indexes.some(index => index.name === '[realmId+threadId+createdAt+id]')).toBe(true);
    expect(db.discussionReadStates.schema.indexes.some(index => index.name === '[id+lastReadAt]')).toBe(true);
  }
});
