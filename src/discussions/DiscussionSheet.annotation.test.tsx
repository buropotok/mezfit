// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { uploadDirectMedia } from '../media/directMediaUpload';
import { copyAnnotationImage } from './discussion-annotation';
import { inspectDiscussionMedia } from './discussion-media-file';
import { DiscussionSheet, type DiscussionSheetProps } from './DiscussionSheet';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';

vi.mock('./discussion-annotation', async importOriginal => ({
  ...await importOriginal<typeof import('./discussion-annotation')>(),
  copyAnnotationImage: vi.fn(),
}));
vi.mock('./DiscussionAnnotationEditor', () => ({
  DiscussionAnnotationEditor: ({ onPrepare, onCancel }: { onPrepare: (file: File) => void; onCancel: () => void }) =>
    <><button onClick={() => onPrepare(new File(['photo'], 'annotation.jpg', { type: 'image/jpeg' }))}>Подготовить фото</button>
      <button onClick={onCancel}>Отменить разметку</button></>,
}));
vi.mock('./discussion-media-file', () => ({ inspectDiscussionMedia: vi.fn() }));
vi.mock('../media/directMediaUpload', async importOriginal => ({
  ...await importOriginal<typeof import('../media/directMediaUpload')>(), uploadDirectMedia: vi.fn(),
}));
vi.mock('../media/discussionMediaCache', async importOriginal => ({
  ...await importOriginal<typeof import('../media/discussionMediaCache')>(),
  readDiscussionMedia: vi.fn(async () => null), downloadDiscussionMedia: vi.fn(async () => null),
  storeDiscussionMedia: vi.fn(async () => undefined),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it.each(['photo', 'video'] as const)('previews and sends a marked-up %s as an ordinary photo reply', async type => {
  const mimeType = type === 'photo' ? 'image/jpeg' : 'video/mp4';
  const original = { ...message('original', 'Исходник', 'tg:2'), attachments: [{
    id: 'source', messageId: 'original', realmId: thread.realmId, owner: 'tg:2', authorUserId: 'tg:2',
    mediaType: type, mimeType, sizeBytes: 3, durationSeconds: type === 'video' ? 15 : null,
    storageKey: 'mvp-media/' + 'e'.repeat(64), uploadState: 'ready' as const, confirmedAt: thread.createdAt,
  }] };
  const metadata: DiscussionMediaDraft = {
    id: 'marked-photo', storageKey: 'mvp-media/' + 'a'.repeat(64), mediaType: 'photo',
    mimeType: 'image/jpeg', sizeBytes: 5, durationSeconds: null, fileName: 'annotation.jpg', uploadState: 'uploading',
  };
  const uploaded = { key: metadata.storageKey, url: 'https://example.org/photo.jpg',
    contentType: metadata.mimeType, sizeBytes: metadata.sizeBytes, fileName: metadata.fileName };
  const { port } = fixture([original]);
  const navigation = vi.fn<DiscussionSheetProps['onNavigationContextChange']>();
  vi.mocked(inspectDiscussionMedia).mockImplementation(async file => ({ file, metadata }));
  vi.mocked(uploadDirectMedia).mockResolvedValue(uploaded);
  vi.mocked(copyAnnotationImage).mockImplementation(() => document.createElement('canvas'));
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:annotation');
    static revokeObjectURL = vi.fn();
  });
  render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={{ ...port, supportsMedia: true }}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}}
    parentNavigation={null} onNavigationContextChange={navigation} /></KonstaProvider>);
  fireEvent.click(await screen.findByRole('link', { name: type === 'photo' ? 'Открыть фото' : 'Открыть видео' }));
  fireEvent.click(screen.getByRole('button', { name: 'Во весь экран' }));
  const viewer = () => screen.getByLabelText('Просмотр вложения');
  await waitFor(() => expect(viewer().querySelector('img[src], video[src]')).not.toBeNull());
  const media = viewer().querySelector('img, video');
  if (media instanceof HTMLImageElement) fireEvent.load(media);
  else if (media instanceof HTMLVideoElement) {
    Object.defineProperty(media, 'readyState', { value: 2 });
    media.currentTime = 7.375;
    fireEvent.loadedMetadata(media);
    fireEvent.loadedData(media);
  } else throw new Error('Missing source media');

  fireEvent.click(screen.getByRole('button', { name: 'Рисовать на изображении' }));
  expect(copyAnnotationImage).toHaveBeenCalledWith(media);
  act(() => navigation.mock.lastCall?.[0]?.onBack?.());
  expect(screen.queryByRole('button', { name: 'Подготовить фото' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Просмотр вложения' }).contains(media)).toBe(true);
  expect(port.saveDraft).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Рисовать на изображении' }));
  if (media instanceof HTMLVideoElement) media.currentTime = 9;
  fireEvent.click(screen.getByRole('button', { name: 'Подготовить фото' }));
  await screen.findByAltText('Предпросмотр фото');
  expect(port.send).not.toHaveBeenCalled();
  expect(uploadDirectMedia).not.toHaveBeenCalled();
  if (type === 'video') {
    fireEvent.click(screen.getByRole('button', { name: 'Открыть видео на 00:07' }));
    await waitFor(() => expect(viewer().querySelector('video[src]')).not.toBeNull());
    const replay = viewer().querySelector('video');
    if (!replay) throw new Error('Missing replay');
    fireEvent.loadedMetadata(replay);
    expect(replay.currentTime).toBe(7.375);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
  } else {
    expect(screen.getByRole('button', { name: 'Перейти к исходному сообщению' })).toBeTruthy();
  }
  fireEvent.change(screen.getByPlaceholderText('Сообщение'), { target: { value: 'Посмотри линию' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
  await waitFor(() => expect(port.send).toHaveBeenCalledWith(expect.objectContaining({
    text: 'Посмотри линию', replyToMessageId: original.id, draftMedia: metadata,
    ...(type === 'video' ? { replyVideoPosition: { attachmentId: 'source', seconds: 7.375 } } : {}),
  }), uploaded));
});
