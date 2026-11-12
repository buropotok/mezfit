// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import type { DiscussionMessageInput } from '../data/cloud/discussions';
import { directMediaUrl, MediaUploadError, uploadDirectMedia, type UploadedMedia } from '../media/directMediaUpload';
import { readDiscussionMedia, storeDiscussionMedia } from '../media/discussionMediaCache';
import { DiscussionMedia } from './DiscussionMedia';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';
import { inspectDiscussionMedia } from './discussion-media-file';
import { useDiscussionDraft } from './useDiscussionDraft';

vi.mock('./discussion-media-file', () => ({ inspectDiscussionMedia: vi.fn() }));
vi.mock('../media/directMediaUpload', async importOriginal => ({
  ...await importOriginal<typeof import('../media/directMediaUpload')>(),
  uploadDirectMedia: vi.fn(),
}));
vi.mock('../media/discussionMediaCache', async importOriginal => ({
  ...await importOriginal<typeof import('../media/discussionMediaCache')>(),
  readDiscussionMedia: vi.fn(async () => null),
  storeDiscussionMedia: vi.fn(async () => undefined),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

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
  const retry = await screen.findByRole('button', { name: 'Ещё раз' });
  expect(port.send).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(port.send).toHaveBeenCalledOnce());
  const first = vi.mocked(port.saveDraft).mock.calls[0][0];
  expect(port.send).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, text: '', draftMedia: metadata }), uploaded);
  expect(vi.mocked(uploadDirectMedia).mock.calls.map(([, options]) => options?.retryKey)).toEqual([
    metadata.storageKey, metadata.storageKey,
  ]);
});

it('automatically delivers a confirmed set video as its own message and leaves the chat draft in place', async () => {
  const existing = { id: 'existing-draft', threadId: thread.id, text: 'Набранный черновик', createdAt: thread.createdAt };
  const port = { ...fixture().port, supportsMedia: true, getDraft: async () => existing };
  const file = new File(['video'], 'Видео.mp4', { type: 'video/mp4' });
  const metadata: DiscussionMediaDraft = { id: 'set-video', storageKey: 'mvp-media/' + 'b'.repeat(64),
    mediaType: 'video', mimeType: file.type, sizeBytes: file.size, durationSeconds: 2,
    fileName: file.name, uploadState: 'uploading' };
  const uploaded: UploadedMedia = { key: metadata.storageKey, url: directMediaUrl(metadata.storageKey) ?? '',
    contentType: file.type, sizeBytes: file.size, fileName: file.name };
  vi.mocked(inspectDiscussionMedia).mockResolvedValue({ file, metadata });
  vi.mocked(uploadDirectMedia).mockRejectedValueOnce(new MediaUploadError('NETWORK')).mockResolvedValueOnce(uploaded);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:set-video');
    static revokeObjectURL = vi.fn();
  });
  const takeRecordedVideo = vi.fn<() => File | undefined>().mockReturnValueOnce(file);
  render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port} threadId={thread.id}
    anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}} parentNavigation={null}
    onNavigationContextChange={() => {}} takeRecordedVideo={takeRecordedVideo} /></KonstaProvider>);

  const retry = await screen.findByRole('button', { name: 'Ещё раз' });
  expect(uploadDirectMedia).toHaveBeenCalledWith(file, expect.objectContaining({ retryKey: metadata.storageKey }));
  expect(port.send).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(port.send).toHaveBeenCalledOnce());
  const drafts = vi.mocked(port.saveDraft).mock.calls.map(([command]) => command);
  expect(drafts).toHaveLength(2);
  expect(drafts[0]).toEqual(drafts[1]);
  expect(drafts[0].id).not.toBe(existing.id);
  expect(port.send).toHaveBeenCalledWith(expect.objectContaining({
    id: drafts[0].id, threadId: thread.id, text: '', draftMedia: metadata,
  }), uploaded);
  expect(screen.getByPlaceholderText('Сообщение')).toHaveProperty('value', existing.text);
});

it('shows the local video during upload, cancels on tap and retries the same file after reopening', async () => {
  const file = new File(['video'], 'Видео.mp4', { type: 'video/mp4' });
  const metadata: DiscussionMediaDraft = { id: 'local-video', storageKey: 'mvp-media/' + 'd'.repeat(64),
    mediaType: 'video', mimeType: file.type, sizeBytes: file.size, durationSeconds: 2,
    fileName: file.name, uploadState: 'uploading' };
  const uploaded: UploadedMedia = { key: metadata.storageKey, url: directMediaUrl(metadata.storageKey) ?? '',
    contentType: file.type, sizeBytes: file.size, fileName: file.name };
  let saved: DiscussionMessageInput | null = null;
  const port = { ...fixture().port, supportsMedia: true, getDraft: async () => saved,
    send: vi.fn(async (input: DiscussionMessageInput, _media?: UploadedMedia) => {
      saved = null;
      return message(input.id, input.text);
    }),
    saveDraft: vi.fn(async (input: DiscussionMessageInput) => { saved = input; }) };
  vi.mocked(inspectDiscussionMedia).mockResolvedValue({ file, metadata });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:local-video');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(uploadDirectMedia).mockImplementationOnce((_file, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new MediaUploadError('CANCELLED')), { once: true });
  })).mockResolvedValueOnce(uploaded);
  const renderChat = (takeRecordedVideo?: () => File | undefined) => render(<KonstaProvider theme="ios" dark>
    <DiscussionSheet opened repository={port} threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })}
      onClose={() => {}} parentNavigation={null} onNavigationContextChange={() => {}} takeRecordedVideo={takeRecordedVideo} />
  </KonstaProvider>);
  const view = renderChat(vi.fn<() => File | undefined>().mockReturnValueOnce(file));
  expect(await screen.findByAltText('Отправляется')).toBeTruthy();
  expect(view.container.querySelector('[data-message-id] video')?.getAttribute('src')).toBe('blob:local-video');
  await waitFor(() => expect(uploadDirectMedia).toHaveBeenCalledOnce());
  expect(storeDiscussionMedia).toHaveBeenCalledWith(expect.objectContaining({ storageKey: metadata.storageKey }), file, true);
  expect(vi.mocked(storeDiscussionMedia).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(uploadDirectMedia).mock.invocationCallOrder[0]);
  const first = port.saveDraft.mock.calls[0][0];
  fireEvent.click(screen.getByRole('button', { name: 'Отменить загрузку' }));
  expect(await screen.findByRole('img', { name: 'Отправка не удалась' })).toBeTruthy();
  expect(screen.queryByAltText('Отправляется')).toBeNull();
  expect(port.send).not.toHaveBeenCalled();
  view.unmount();

  vi.mocked(readDiscussionMedia).mockResolvedValueOnce(file);
  renderChat();
  fireEvent.click(await screen.findByRole('button', { name: 'Ещё раз' }));
  await waitFor(() => expect(port.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    id: first.id, threadId: thread.id, draftMedia: metadata,
  }), uploaded));
  expect(inspectDiscussionMedia).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Ещё раз' })).toBeNull();
});

it('plays and exports a failed local video offline without removing its retry draft', async () => {
  const file = new File(['video'], 'Видео.mp4', { type: 'video/mp4' });
  const draftMedia: DiscussionMediaDraft = { id: 'offline-video', storageKey: 'mvp-media/' + 'e'.repeat(64),
    mediaType: 'video', mimeType: file.type, sizeBytes: file.size, durationSeconds: 2,
    fileName: file.name, uploadState: 'failed' };
  const discardDraft = vi.fn(async () => {});
  const updateDraftMedia = vi.fn(async () => {});
  const port = { ...fixture().port, supportsMedia: true, discardDraft, updateDraftMedia,
    getDraft: async () => ({ id: 'offline-draft', threadId: thread.id, text: '', createdAt: thread.createdAt, draftMedia }) };
  vi.mocked(readDiscussionMedia).mockResolvedValueOnce(file);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:offline-video');
    static revokeObjectURL = vi.fn();
  });
  const share = vi.fn(async (_data: ShareData) => {});
  const properties = ['onLine', 'canShare', 'share'] as const;
  const descriptors = properties.map(key => Object.getOwnPropertyDescriptor(navigator, key));
  Object.defineProperties(navigator, {
    onLine: { configurable: true, value: false },
    canShare: { configurable: true, value: () => true },
    share: { configurable: true, value: share },
  });
  try {
    render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port} threadId={thread.id}
      anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}} parentNavigation={null}
      onNavigationContextChange={() => {}} /></KonstaProvider>);

    fireEvent.click(await screen.findByRole('link', { name: 'Открыть видео' }));
    const player = screen.getByRole('region', { name: 'Просмотр вложения' }).querySelector('video');
    expect(player?.src).toBe('blob:offline-video');
    expect(player?.controls).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));

    fireEvent.click(screen.getByRole('button', { name: 'Действия неотправленного видео' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Сохранить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(share).toHaveBeenCalledExactlyOnceWith({ files: [
      expect.objectContaining({ name: file.name, type: file.type, size: file.size }),
    ] }));
    await waitFor(() => expect(screen.queryByText('Сохранить видео')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Убрать вложение' }));
    expect(screen.getByText('Убрать неотправленное видео?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.getByRole('button', { name: 'Ещё раз' })).toBeTruthy();
    expect(discardDraft).not.toHaveBeenCalled();
    expect(updateDraftMedia).not.toHaveBeenCalled();
    expect(uploadDirectMedia).not.toHaveBeenCalled();
  } finally {
    properties.forEach((key, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(navigator, key, descriptor);
      else Reflect.deleteProperty(navigator, key);
    });
  }
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

it('seeks only the in-chat thumbnail to a frame within the clip', () => {
  const src = 'blob:gallery-video';
  const { container, rerender } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src={src} type="video" mode="thumbnail" />
  </KonstaProvider>);
  const video = container.querySelector('video');
  if (!video) throw new Error('Missing thumbnail video');
  Object.defineProperty(video, 'duration', { configurable: true, value: 8 });
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(3);

  Object.defineProperty(video, 'duration', { configurable: true, value: 2 });
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(1);

  rerender(<KonstaProvider theme="ios" dark><DiscussionMedia src={src} type="video" mode="viewer" /></KonstaProvider>);
  const player = container.querySelector('video');
  if (!player) throw new Error('Missing video player');
  Object.defineProperty(player, 'duration', { configurable: true, value: 8 });
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(0);
});

it('comments from the fullscreen pause and reopens the exact frame from the composer and a saved quote', async () => {
  localStorage.removeItem('mezfit.discussion.videoCommentUsed');
  const original = {
    ...message('original-video', '', 'tg:2'),
    attachments: [{
      id: 'source-attachment', messageId: 'original-video', realmId: thread.realmId, owner: 'tg:2', authorUserId: 'tg:2',
      mediaType: 'video' as const, mimeType: 'video/mp4', sizeBytes: 3, durationSeconds: 15,
      storageKey: 'mvp-media/' + 'e'.repeat(64), uploadState: 'ready' as const, confirmedAt: thread.createdAt,
    }],
  };
  const savedReply = {
    ...message('saved-reply', 'Стоп-кадр', 'tg:1', 1),
    reply: { messageId: original.id, authorUserId: 'tg:2', text: '', unavailable: false, deleted: false,
      videoPosition: { attachmentId: original.attachments[0].id, seconds: 4.5 } },
  };
  const { port, replace } = fixture([original, savedReply]);
  vi.mocked(port.getMessage).mockImplementation(async () => original);
  const discussion = <KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port} threadId={thread.id}
    anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}} parentNavigation={null}
    onNavigationContextChange={() => {}} /></KonstaProvider>;
  const view = render(discussion);
  const label = 'Прокомментировать стопкадр';
  const hint = 'Нажмите, чтобы прокомментировать стопкадр.';
  const viewerVideo = () => {
    const video = screen.getByLabelText('Просмотр вложения').querySelector('video');
    if (!video) throw new Error('Missing viewer video');
    Object.defineProperty(video, 'duration', { configurable: true, value: 15 });
    return video;
  };

  fireEvent.click(await screen.findByRole('link', { name: 'Открыть видео' }));
  await waitFor(() => expect(viewerVideo().getAttribute('src')).toBeTruthy());
  const player = viewerVideo();
  fireEvent.loadedMetadata(player);
  expect(screen.getByText(hint)).toBeTruthy();
  fireEvent.play(player);
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Во весь экран' }));
  expect(viewerVideo()).toBe(player);
  player.currentTime = 7.375;
  fireEvent.pause(player);
  expect(screen.getByText(hint)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: label }));

  expect(screen.queryByLabelText('Просмотр вложения')).toBeNull();
  const capsule = screen.getByRole('button', { name: '00:07' });
  fireEvent.click(capsule);
  await screen.findByRole('region', { name: 'Просмотр вложения' });
  const frame = viewerVideo();
  fireEvent.loadedMetadata(frame);
  expect(frame.currentTime).toBe(7.375);
  expect(frame.autoplay).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
  fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Проверь этот кадр' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(port.send).toHaveBeenCalledWith(expect.objectContaining({
    text: 'Проверь этот кадр', replyToMessageId: original.id,
    replyVideoPosition: { attachmentId: original.attachments[0].id, seconds: 7.375 },
  })));
  await waitFor(() => expect(screen.queryByRole('button', { name: '00:07' })).toBeNull());

  view.unmount();
  replace([savedReply]);
  render(discussion);
  fireEvent.click(await screen.findByRole('button', { name: 'Открыть видео на 00:04' }));
  await screen.findByRole('region', { name: 'Просмотр вложения' });
  const replay = viewerVideo();
  fireEvent.loadedMetadata(replay);
  expect(replay.currentTime).toBe(4.5);
  expect(screen.getByRole('button', { name: label })).toBeTruthy();
  expect(screen.queryByText(hint)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
  expect(screen.getByText('Стоп-кадр')).toBeTruthy();
  localStorage.removeItem('mezfit.discussion.videoCommentUsed');
});
