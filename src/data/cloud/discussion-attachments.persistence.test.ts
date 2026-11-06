// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_DATABASE_STORES_V15 } from './database';
import { assertMessageAttachmentWrite, applyAttachmentUploadConfirmation, type MessageAttachment } from './discussion-contracts';
const databases: Dexie[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
  vi.unstubAllGlobals();
});

describe('attachment persistence with the pinned Addon (not server ACL tests)', () => {
  it('keeps one row through retries, confirm and reopen, and queries metadata in its realm/message', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('No network expected'))); vi.stubGlobal('fetch', fetch);
    const db = new Dexie('attachment-' + crypto.randomUUID(), { addons: [dexieCloud] }); databases.push(db);
    db.version(15).stores(CLOUD_DATABASE_STORES_V15);
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true,
      disableWebSocket: true, tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    const thread = { id: 'thread', realmId: 'pair-a' };
    const message = { id: 'message', threadId: thread.id, realmId: thread.realmId, owner: 'tg:1', authorUserId: 'tg:1' };
    let row: MessageAttachment = { id: 'attachment', realmId: thread.realmId, messageId: message.id,
      owner: 'tg:1', authorUserId: 'tg:1', mediaType: 'voice', mimeType: 'audio/mp4', sizeBytes: 123,
      durationSeconds: 5, storageKey: null, uploadState: 'pending', confirmedAt: null };
    const table = db.table<MessageAttachment, string>('messageAttachments');
    assertMessageAttachmentWrite('tg:1', thread, message, row);
    await table.add(row);
    for (const uploadState of ['uploading', 'failed', 'uploading'] as const) {
      const next = { ...row, uploadState };
      assertMessageAttachmentWrite('tg:1', thread, message, next, row);
      await table.update(row.id, { uploadState }); row = next;
    }
    const confirmation = { attachmentId: row.id, realmId: row.realmId, messageId: row.messageId,
      authorUserId: row.authorUserId, mediaType: row.mediaType, mimeType: row.mimeType,
      sizeBytes: row.sizeBytes, durationSeconds: row.durationSeconds, storageKey: 'pair-a/attachment/voice',
      confirmedAt: '2026-11-06T10:00:00.000Z' };
    row = applyAttachmentUploadConfirmation('tg:1', thread, message, row, confirmation);
    await table.update(row.id, { storageKey: row.storageKey, uploadState: row.uploadState, confirmedAt: row.confirmedAt });
    const repeated = applyAttachmentUploadConfirmation('tg:1', thread, message, row, confirmation);
    await table.update(repeated.id, { confirmedAt: repeated.confirmedAt });
    db.close(); await db.open();
    expect(await table.get(row.id)).toMatchObject(row);
    expect(await table.count()).toBe(1);
    expect((await table.where('[realmId+messageId]').equals([row.realmId, row.messageId]).toArray()).map(item => item.id)).toEqual([row.id]);
    expect(await table.where('[realmId+messageId]').equals(['pair-b', row.messageId]).count()).toBe(0);
    expect(db.cloud.schema?.messageAttachments.markedForSync).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
