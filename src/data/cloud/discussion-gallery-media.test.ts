// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipMembership } from '../../../worker/lib/dexie-cloud-membership';
import { directMediaUrl, uploadDirectMedia } from '../../media/directMediaUpload';
import { mockSignedMediaTransport, signedMediaResponse } from '../../media/mediaUploadTestFixtures';
import { MezfitCloudDatabase } from './database';
import type { DiscussionMediaDraft } from './discussion-media';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread } from './discussions';

const key = 'mvp-media/' + 'a'.repeat(64);
const media: DiscussionMediaDraft = {
  id: 'attachment', storageKey: key, mediaType: 'video', mimeType: 'video/mp4', sizeBytes: 3,
  durationSeconds: 180, fileName: 'sample.mp4', uploadState: 'uploading',
};
const uploaded = { key, url: directMediaUrl(key) ?? '', sizeBytes: 3, contentType: 'video/mp4', fileName: 'sample.mp4' };
const databases: Dexie[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('gallery attachments', () => {
  it('reuses the conditional PUT key and checks storage after a lost success response', async () => {
    const put = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection interrupted'))
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { headers: { 'Content-Length': '3', 'Content-Type': 'video/mp4' } }));
    const signer = vi.fn<typeof fetch>()
      .mockImplementationOnce(async (_url, init) => signedMediaResponse(init, { signature: 'a'.repeat(64) }))
      .mockImplementationOnce(async (_url, init) => signedMediaResponse(init));
    mockSignedMediaTransport(put, signer);
    const file = new File(['mp4'], 'sample.mp4', { type: 'video/mp4' });
    await expect(uploadDirectMedia(file, { retryKey: key })).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(uploadDirectMedia(file, { retryKey: key })).resolves.toEqual(uploaded);
    expect(put.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [expect.stringContaining(uploaded.url + '?'), 'PUT'],
      [expect.stringContaining(uploaded.url + '?'), 'PUT'],
      [uploaded.url, 'HEAD'],
    ]);
    expect(put.mock.calls[0][0]).not.toBe(put.mock.calls[1][0]);
    expect(signer).toHaveBeenCalledTimes(2);
    expect(signer.mock.calls[0][1]?.body).toBe(signer.mock.calls[1][1]?.body);
    expect(put.mock.calls[1][1]).toMatchObject({ body: file, headers: { 'If-None-Match': '*' } });
  });

  it('keeps failed metadata private, publishes an attachment-only message once, and hides it on deletion', async () => {
    const db = new MezfitCloudDatabase('9987654321', '', { discussions: true });
    databases.push(db);
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true, disableWebSocket: true,
      tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    await db.open();
    const pair = await relationshipMembership('11', '22');
    await new Promise<void>((resolve, reject) => {
      const tx = db.backendDB().transaction(['realms', 'members'], 'readwrite');
      tx.objectStore('realms').put(pair.realm);
      for (const member of pair.members) tx.objectStore('members').put(member);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const scope = { realmId: pair.realm.realmId, coachClientId: pair.realm.realmId };
    const coach = new DiscussionRepository(db, 'tg:11', scope);
    const client = new DiscussionRepository(db, 'tg:22', scope);
    const thread = await coach.createThread(prepareDiscussionThread({ kind: 'program', trainingPlanId: 'plan' }, 'Тест', '2026-11-09'));
    const command = { ...prepareDiscussionMessage(thread.id, ''), draftMedia: media, requireUnsentDraft: true as const };
    await client.saveDraft(command);
    await client.updateDraftMedia(thread.id, command.id, key, 'failed');
    expect(await client.getDraft(thread.id)).toMatchObject({ draftMedia: { storageKey: key, uploadState: 'failed' } });
    expect(await coach.getDraft(thread.id)).toBeNull();
    expect((await coach.page(thread.id)).messages).toEqual([]);
    await expect(client.send(command)).rejects.toThrow('INVALID_DISCUSSION_ATTACHMENT');
    await client.send(command, uploaded);
    await client.send(command, uploaded);
    expect(await db.messageAttachments.count()).toBe(1);
    expect(await client.getDraft(thread.id)).toBeNull();
    const published = await db.discussionMessages.get(command.id);
    expect(published?.realmId).toBe(scope.realmId);
    expect(published?.draftMedia).toBeUndefined();
    expect((await coach.page(thread.id)).messages).toMatchObject([
      { id: command.id, text: '', attachments: [{ id: media.id, storageKey: key, owner: 'tg:22', uploadState: 'ready' }] },
    ]);
    await client.remove(thread.id, command.id);
    expect((await coach.getMessage(thread.id, command.id)).attachments).toBeUndefined();
  });
});

it('publishes gallery media and typed text as two messages in one retryable send', async () => {
  const actor = 'tg:22';
  const db = new MezfitCloudDatabase('9987654322', '', { discussions: true });
  databases.push(db);
  db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true, disableWebSocket: true,
    tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
  await db.open();
  const repository = new DiscussionRepository(db, actor, { realmId: actor, coachClientId: null });
  const thread = await repository.createThread(prepareDiscussionThread(
    { kind: 'program', trainingPlanId: 'plan' }, 'Тест', '2026-11-09',
  ));
  const command = { ...prepareDiscussionMessage(thread.id, 'Текст к видео'), draftMedia: media, requireUnsentDraft: true as const };
  await repository.saveDraft(command);
  await repository.send(command, uploaded);
  await repository.send(command, uploaded);

  const { messages } = await repository.page(thread.id);
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({ id: command.id, text: '', attachments: [{ id: media.id }] });
  expect(messages[1]).toMatchObject({ text: 'Текст к видео' });
  expect(messages[1].attachments).toBeUndefined();
  expect(await repository.getDraft(thread.id)).toBeNull();
});
