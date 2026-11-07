import { describe, expect, it } from 'vitest';
import { createDiscussionPreviewPort, previewDiscussionThread } from './discussion-preview';
describe('UI kit discussion draft adapter', () => {
  it('recovers private preview drafts per instance and clears them on publication', async () => {
    const first = createDiscussionPreviewPort(), second = createDiscussionPreviewPort();
    const input = { id: 'preview-draft', threadId: previewDiscussionThread.id, text: 'Draft text',
      createdAt: '2020-01-01T00:00:00.000Z', replyToMessageId: 'preview-2' };
    await first.saveDraft(input);
    expect(await first.getDraft(input.threadId)).toEqual(input);
    expect(await second.getDraft(input.threadId)).toBeNull();
    const sent = await first.send(input);
    expect(sent.id).toBe(input.id);
    expect(sent.createdAt > input.createdAt).toBe(true);
    expect(await first.getDraft(input.threadId)).toBeNull();
    expect(await first.send(input)).toEqual(sent);
    await expect(first.saveDraft(input)).rejects.toThrow('PREVIEW_DRAFT_ALREADY_SENT');
  });
  it('models strict draft publication without changing ordinary preview retries', async () => {
    const port = createDiscussionPreviewPort();
    const input = { id: 'strict-preview', threadId: previewDiscussionThread.id, text: 'Draft',
      createdAt: '2026-11-07T00:00:00.000Z' };
    await expect(port.send({ ...input, requireUnsentDraft: true })).rejects.toThrow('DISCUSSION_DRAFT_NOT_SAVED');
    await port.saveDraft(input);
    const sent = await port.send({ ...input, requireUnsentDraft: true });
    await expect(port.send({ ...input, text: 'New intent', requireUnsentDraft: true })).rejects.toThrow('DISCUSSION_DRAFT_ALREADY_PUBLISHED');
    expect(await port.send(input)).toEqual(sent);
  });

});
