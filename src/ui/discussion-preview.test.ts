import { describe, expect, it } from 'vitest';
import { createDiscussionPreviewPort, previewDiscussionAnchor, previewDiscussionThread } from './discussion-preview';

const threadId = previewDiscussionThread.id;

describe('isolated UI kit discussion preview', () => {
  it('exposes realistic data without a database and isolates each preview instance', async () => {
    const first = createDiscussionPreviewPort();
    const second = createDiscussionPreviewPort();
    expect(await first.listThreads(previewDiscussionAnchor)).toEqual([previewDiscussionThread]);
    expect(await first.listThreads({ kind: 'program', trainingPlanId: 'different' })).toEqual([]);
    expect((await first.page(threadId)).messages).toHaveLength(7);

    const input = { id: 'local-demo-message', threadId, text: 'Проверяю отправку', createdAt: '2026-11-06T10:00:00.000Z' };
    await first.send(input);
    await first.send({ ...input, text: 'Повторная попытка с тем же ID' });
    expect((await first.page(threadId)).messages).toHaveLength(8);
    expect((await second.page(threadId)).messages).toHaveLength(7);
    expect((await first.getMessage(threadId, input.id)).text).toBe('Проверяю отправку');
  });

  it('updates live pages and disables callbacks on unsubscribe', async () => {
    const port = createDiscussionPreviewPort();
    const updates: number[] = [];
    const sub = port.observePage(threadId, page => updates.push(page.messages.length), () => {});
    await Promise.resolve();
    expect(updates).toEqual([7]);
    await port.send({ id: 'preview-new', threadId, text: 'Новое сообщение', createdAt: '2026-11-06T10:00:00.000Z' });
    expect(updates).toEqual([7, 8]);
    sub.unsubscribe();
    await port.remove(threadId, 'preview-1');
    expect(updates).toEqual([7, 8]);
  });

  it('supports own edit/delete and resolves quotes from current original text', async () => {
    const port = createDiscussionPreviewPort();
    await port.send({ id: 'preview-answer', threadId, text: 'Ответ на сообщение', replyToMessageId: 'preview-1',
      createdAt: '2026-11-06T10:00:00.000Z' });
    expect((await port.getMessage(threadId, 'preview-answer')).reply?.text).toContain('Доброе утро');
    await port.edit(threadId, 'preview-1', 'Исправленный текст');
    expect((await port.getMessage(threadId, 'preview-answer')).reply?.text).toBe('Исправленный текст');
    await port.remove(threadId, 'preview-1');
    const original = await port.getMessage(threadId, 'preview-1');
    expect(original.deleted).toBe(true);
    expect(original.text).toBe('');
    const reply = (await port.getMessage(threadId, 'preview-answer')).reply;
    expect(reply).toMatchObject({ deleted: true, unavailable: false, text: '' });
    await expect(port.edit(threadId, 'preview-2', 'Чужая реплика')).rejects.toThrow('PREVIEW_EDIT_FORBIDDEN');
    await expect(port.remove(threadId, 'preview-2')).rejects.toThrow('PREVIEW_DELETE_FORBIDDEN');
  });
});
