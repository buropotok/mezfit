import { describe, expect, it } from 'vitest';
import { assertMessageAttachmentWrite, applyAttachmentUploadConfirmation, isAttachmentUploadConfirmation,
  type MessageAttachment, type AttachmentUploadConfirmation } from './discussion-attachment';
const time = '2026-11-06T10:00:00.000Z';
const thread = { id: 'thread', realmId: 'pair-a' };
const message = { id: 'message', realmId: thread.realmId, threadId: thread.id, owner: 'tg:1', authorUserId: 'tg:1' };
const attachment: MessageAttachment = { id: 'attachment', realmId: thread.realmId, messageId: message.id,
  owner: 'tg:1', authorUserId: 'tg:1', mediaType: 'video', mimeType: 'video/mp4', sizeBytes: 1234,
  durationSeconds: 180, storageKey: null, uploadState: 'pending', confirmedAt: null };
const confirmation: AttachmentUploadConfirmation = { attachmentId: attachment.id, realmId: thread.realmId,
  messageId: message.id, authorUserId: message.authorUserId, mediaType: 'video', mimeType: 'video/mp4',
  sizeBytes: 1234, durationSeconds: 180, storageKey: 'pair-a/attachment/object', confirmedAt: time };
const check = (next: MessageAttachment, previous?: MessageAttachment) =>
  assertMessageAttachmentWrite('tg:1', thread, message, next, previous);

describe('attachment application contracts; not live server ACL verification', () => {
  it.each(['tg:1', 'tg:2'])('permits %s own photo, video and voice metadata without text', actor => {
    for (const [mediaType, mimeType, durationSeconds] of [
      ['photo', 'image/heic', null], ['video', 'video/quicktime', 180], ['voice', 'audio/mp4; codecs=mp4a.40.2', 10],
    ] as const) {
      const mediaMessage = { ...message, owner: actor, authorUserId: actor, text: '' };
      expect(() => assertMessageAttachmentWrite(actor, thread, mediaMessage,
        { ...attachment, owner: actor, authorUserId: actor, mediaType, mimeType, durationSeconds })).not.toThrow();
    }
  });
  it('rejects another author, message, thread and realm; ownership is not membership proof', () => {
    for (const patch of [{ owner: 'tg:2' }, { authorUserId: 'tg:2' }, { messageId: 'other' }, { realmId: 'pair-b' }])
      expect(() => check({ ...attachment, ...patch })).toThrow();
    expect(() => assertMessageAttachmentWrite('tg:2', thread, message, attachment)).toThrow();
    expect(() => assertMessageAttachmentWrite('tg:1', { ...thread, realmId: 'pair-b' }, message, attachment)).toThrow();
    expect(() => assertMessageAttachmentWrite('tg:1', thread, { ...message, threadId: 'other' }, attachment)).toThrow();
  });
  it('preserves the same identity through failed upload, retry and repeated confirmation', () => {
    const uploading: MessageAttachment = { ...attachment, uploadState: 'uploading', storageKey: confirmation.storageKey };
    const failed: MessageAttachment = { ...uploading, uploadState: 'failed' };
    expect(() => check(uploading, attachment)).not.toThrow();
    expect(() => check(failed, uploading)).not.toThrow();
    expect(() => check(uploading, failed)).not.toThrow();
    const ready = applyAttachmentUploadConfirmation('tg:1', thread, message, uploading, confirmation);
    expect(ready).toEqual({ ...uploading, uploadState: 'ready', confirmedAt: time });
    expect(applyAttachmentUploadConfirmation('tg:1', thread, message, ready, confirmation)).toEqual(ready);
    expect(ready.id).toBe(attachment.id);
    expect(() => check({ ...uploading, id: 'duplicate' }, failed)).toThrow();
    expect(() => check({ ...ready, uploadState: 'failed' }, ready)).toThrow();
    expect(() => check({ ...ready, storageKey: 'another-object' }, ready)).toThrow();
  });
  it('rejects false-ready and malformed, mismatched or URL-bearing confirmations', () => {
    expect(() => check({ ...attachment, uploadState: 'ready' })).toThrow();
    for (const bad of [null, {}, { ...confirmation, sizeBytes: '1234' }, { ...confirmation, confirmedAt: 'invalid' },
      { ...confirmation, storageKey: 'https://example.test/object?token=secret' }]) {
      expect(isAttachmentUploadConfirmation(bad)).toBe(false);
      expect(() => applyAttachmentUploadConfirmation('tg:1', thread, message, attachment, bad)).toThrow();
    }
    for (const patch of [{ attachmentId: 'other' }, { messageId: 'other' }, { realmId: 'pair-b' },
      { authorUserId: 'tg:2' }, { sizeBytes: 99 }, { mimeType: 'video/quicktime' }, { durationSeconds: 5 }])
      expect(() => applyAttachmentUploadConfirmation('tg:1', thread, message, attachment, { ...confirmation, ...patch })).toThrow();
  });
  it('supports tombstones, forbids upload after deletion and leaves remote object deletion to the gateway', () => {
    const deleted = { ...attachment, deletedAt: time };
    expect(() => check(deleted, attachment)).not.toThrow();
    expect(() => check(attachment, deleted)).toThrow();
    expect(() => applyAttachmentUploadConfirmation('tg:1', thread, message, deleted, confirmation)).toThrow();
    expect(() => assertMessageAttachmentWrite('tg:1', thread, { ...message, deletedAt: time }, attachment)).toThrow();
    expect(() => assertMessageAttachmentWrite('tg:1', thread, { ...message, deletedAt: time }, deleted)).not.toThrow();
  });
  it('validates actual media descriptors without imposing one codec on both platforms', () => {
    for (const patch of [{ sizeBytes: 0 }, { sizeBytes: NaN }, { durationSeconds: 181 }, { durationSeconds: null },
      { mimeType: 'audio/webm' }, { storageKey: '../object' }]) expect(() => check({ ...attachment, ...patch })).toThrow();
    expect(() => check({ ...attachment, authorUserId: 'tg:1', mediaType: 'voice', mimeType: 'audio/webm', durationSeconds: 10 })).not.toThrow();
  });
});
