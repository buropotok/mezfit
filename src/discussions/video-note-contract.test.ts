// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { assertMessageAttachmentWrite, type MessageAttachment } from '../../shared/discussion-attachment';
import { isDiscussionMediaDraft } from '../data/cloud/discussion-media';
import { prepareDiscussionVideoNote } from './discussion-media-file';

it('validates a video note as a distinct circular attachment, capped at 60 seconds', () => {
  const record: MessageAttachment = {
    id: 'attachment', realmId: 'pair', owner: 'tg:1', authorUserId: 'tg:1',
    messageId: 'message', mediaType: 'video-note', mimeType: 'video/mp4',
    sizeBytes: 4, durationSeconds: 60, storageKey: null, uploadState: 'pending', confirmedAt: null,
  };
  const thread = { id: 'thread', realmId: 'pair' };
  const message = { id: 'message', realmId: 'pair', threadId: 'thread', owner: 'tg:1', authorUserId: 'tg:1' };
  const check = (attachment: MessageAttachment) =>
    assertMessageAttachmentWrite('tg:1', thread, message, attachment);
  expect(() => check(record)).not.toThrow();
  expect(() => check({ ...record, durationSeconds: 60.01 })).toThrow();
  expect(() => check({ ...record, mimeType: 'audio/mp4' })).toThrow();
  expect(() => check({ ...record, waveform: [0.5] })).toThrow();
});

it('prepares only a supported video-note for the existing signed media transport', () => {
  const selected = prepareDiscussionVideoNote({
    blob: new Blob(['video'], { type: 'video/webm' }), mimeType: 'video/webm', durationMs: 2500,
  });
  expect(selected.metadata).toMatchObject({
    mediaType: 'video-note', mimeType: 'video/webm', durationSeconds: 2.5,
    sizeBytes: selected.file.size, fileName: 'Видеокружок.webm',
  });
  expect(isDiscussionMediaDraft(selected.metadata)).toBe(true);
  expect(isDiscussionMediaDraft({ ...selected.metadata, durationSeconds: 61 })).toBe(false);
  expect(isDiscussionMediaDraft({ ...selected.metadata, waveform: [] })).toBe(false);
});
