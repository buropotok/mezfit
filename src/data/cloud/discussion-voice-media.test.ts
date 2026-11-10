// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { directMediaUrl } from '../../media/directMediaUpload';
import { MezfitCloudDatabase } from './database';
import { DISCUSSION_MEDIA_ACCEPT, isDiscussionMediaDraft, type DiscussionMediaDraft } from './discussion-media';
import { DiscussionRepository, prepareDiscussionMessage, prepareDiscussionThread } from './discussions';

const storageKey = 'mvp-media/' + 'c'.repeat(64);
const voice: DiscussionMediaDraft = {
  id: 'voice-attachment', storageKey, mediaType: 'voice', mimeType: 'audio/mp4', sizeBytes: 4,
  durationSeconds: 1.2, waveform: [0.1, 0.8], fileName: 'clip.m4a', uploadState: 'uploading',
};

it('validates voice metadata separately from gallery selection', () => {
  expect(DISCUSSION_MEDIA_ACCEPT).not.toContain('audio/');
  expect(isDiscussionMediaDraft(voice)).toBe(true);
  expect(isDiscussionMediaDraft({ ...voice, mimeType: 'video/mp4' })).toBe(false);
  expect(isDiscussionMediaDraft({ ...voice, waveform: [1.5] })).toBe(false);
  expect(isDiscussionMediaDraft({ ...voice, durationSeconds: Infinity })).toBe(false);
});

it('publishes and projects an attachment-only voice once across retries', async () => {
  const actor = 'tg:22';
  const db = new MezfitCloudDatabase('9987654323', '', { discussions: true });
  try {
    db.cloud.configure({ databaseUrl: '', requireAuth: false, disableEagerSync: true, disableWebSocket: true,
      tryUseServiceWorker: false, unsyncedTables: ['localWorkoutOccurrenceDrafts'] });
    await db.open();
    const repository = new DiscussionRepository(db, actor, { realmId: actor, coachClientId: null });
    const thread = await repository.createThread(prepareDiscussionThread(
      { kind: 'program', trainingPlanId: 'plan' }, 'Тест', '2026-11-09',
    ));
    const command = { ...prepareDiscussionMessage(thread.id, ''), draftMedia: voice, requireUnsentDraft: true as const };
    const uploaded = { key: storageKey, url: directMediaUrl(storageKey) ?? '', sizeBytes: voice.sizeBytes,
      contentType: voice.mimeType, fileName: voice.fileName };
    await repository.saveDraft(command);
    await repository.updateDraftMedia(thread.id, command.id, storageKey, 'failed');
    expect((await repository.page(thread.id)).messages).toEqual([]);
    await repository.send(command, uploaded);
    await repository.send(command, uploaded);
    expect((await repository.page(thread.id)).messages).toMatchObject([{
      id: command.id, text: '', attachments: [{
        id: voice.id, mediaType: 'voice', durationSeconds: voice.durationSeconds, waveform: voice.waveform,
      }],
    }]);
    expect(await db.messageAttachments.count()).toBe(1);
  } finally {
    await db.delete();
  }
});
