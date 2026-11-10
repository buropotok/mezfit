// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { directMediaUrl, MediaUploadError, uploadDirectMedia, type UploadedMedia } from '../media/directMediaUpload';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';
import { inspectDiscussionMedia } from './discussion-media-file';
import { useDiscussionDraft } from './useDiscussionDraft';

vi.mock('./discussion-media-file', () => ({ inspectDiscussionMedia: vi.fn() }));
vi.mock('../media/directMediaUpload', async importOriginal => ({
  ...await importOriginal<typeof import('../media/directMediaUpload')>(),
  uploadDirectMedia: vi.fn(),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('previews a photo and retries an attachment-only send with the same message, attachment and object IDs', async () => {
  const port = { ...fixture().port, supportsMedia: true };
  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
  const metadata: DiscussionMediaDraft = { id: 'gallery-photo', storageKey: 'mvp-media/' + 'b'.repeat(64),
    mediaType: 'photo', mimeType: file.type, sizeBytes: file.size, durationSeconds: null,
    fileName: file.name, uploadState: 'uploading' };
  vi.mocked(inspectDiscussionMedia).mockResolvedValue({ file, metadata });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:gallery-preview');
    static revokeObjectURL = vi.fn();
  });
  const uploaded: UploadedMedia = { key: metadata.storageKey, url: directMediaUrl(metadata.storageKey) ?? '',
    contentType: file.type, sizeBytes: file.size, fileName: file.name };
  vi.mocked(uploadDirectMedia).mockRejectedValueOnce(new MediaUploadError('NETWORK')).mockResolvedValueOnce(uploaded);
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port} threadId={thread.id}
    anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}} parentNavigation={null}
    onNavigationContextChange={() => {}} /></KonstaProvider>);
  const add = await screen.findByRole('button', { name: 'Добавить вложение' });
  await waitFor(() => expect(add).toHaveProperty('disabled', false));
  const input = view.baseElement.querySelector('input[type="file"]');
  if (!input) throw new Error('Missing gallery input');
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByAltText('Предпросмотр фото');
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  const retry = await screen.findByRole('button', { name: 'Повторить отправку' });
  expect(port.send).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(port.send).toHaveBeenCalledOnce());
  const first = vi.mocked(port.saveDraft).mock.calls[0][0];
  expect(port.send).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, text: '', draftMedia: metadata }), uploaded);
  expect(vi.mocked(uploadDirectMedia).mock.calls.map(([, options]) => options?.retryKey)).toEqual([
    metadata.storageKey, metadata.storageKey,
  ]);
});

it('acknowledges a restored attachment sent on another device once its metadata arrives', async () => {
  const metadata: DiscussionMediaDraft = { id: 'gallery-photo', storageKey: 'mvp-media/' + 'b'.repeat(64),
    mediaType: 'photo', mimeType: 'image/jpeg', sizeBytes: 5, durationSeconds: null,
    fileName: 'photo.jpg', uploadState: 'failed' };
  const published = message('restored', 'Подпись');
  const getMessage = vi.fn()
    .mockResolvedValueOnce(published)
    .mockResolvedValueOnce({ ...published, attachments: [{ id: metadata.id, storageKey: metadata.storageKey }] });
  const port = { ...fixture().port, getMessage,
    getDraft: async () => ({ ...published, draftMedia: metadata }),
    saveDraft: vi.fn().mockRejectedValue(new Error('DISCUSSION_ID_REUSED')),
  };
  const { result } = renderHook(() => useDiscussionDraft(port, thread.id));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await expect(result.current.stageMedia(metadata)).rejects.toThrow('DISCUSSION_ID_REUSED');
  expect(result.current.media).toEqual(metadata);
  await act(async () => { expect(await result.current.stageMedia(metadata)).toBeNull(); });
  expect(getMessage).toHaveBeenLastCalledWith(thread.id, published.id);
  expect(result.current.media).toBeUndefined();
  expect(result.current.text).toBe('');
  expect(port.send).not.toHaveBeenCalled();
});

it('opens a gallery video in the sheet and returns to the same chat via Back', async () => {
  const video = { ...message('gallery-video', ''), attachments: [{
    id: 'video-attachment', messageId: 'gallery-video', realmId: thread.realmId, owner: 'tg:1', authorUserId: 'tg:1',
    mediaType: 'video' as const, mimeType: 'video/mp4', sizeBytes: 5, durationSeconds: 8,
    storageKey: 'mvp-media/' + 'a'.repeat(64), uploadState: 'ready' as const, confirmedAt: thread.createdAt,
  }] };
  const onNavigationContextChange = vi.fn<DiscussionSheetProps['onNavigationContextChange']>();
  const onClose = vi.fn();
  const { port } = fixture([video]);
  render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port} threadId={thread.id}
    anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={onClose} parentNavigation={null}
    onNavigationContextChange={onNavigationContextChange} /></KonstaProvider>);

  fireEvent.click(await screen.findByRole('link', { name: 'Открыть видео' }));
  const viewer = screen.getByRole('region', { name: 'Просмотр вложения' });
  expect(viewer.querySelector('video')?.controls).toBe(true);
  expect(viewer.closest('[role="dialog"]')?.getAttribute('aria-label')).toBe('Обсуждение');
  act(() => onNavigationContextChange.mock.lastCall?.[0]?.onBack?.());
  expect(screen.queryByRole('region', { name: 'Просмотр вложения' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Открыть видео' })).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});
