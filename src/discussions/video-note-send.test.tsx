// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor, fireEvent } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { directMediaUrl, MediaUploadError, uploadDirectMedia, type UploadedMedia } from '../media/directMediaUpload';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';
import { prepareDiscussionMessage } from '../data/cloud/discussions';
import { DiscussionSheet } from './DiscussionSheet';
import { useDiscussionDraft } from './useDiscussionDraft';
import { useDiscussionMedia } from './useDiscussionMedia';
import { DiscussionVideoNote } from './DiscussionVideoNote';

vi.mock('../media/directMediaUpload', async importOriginal => ({
  ...await importOriginal<typeof import('../media/directMediaUpload')>(),
  uploadDirectMedia: vi.fn(),
}));
vi.mock('../media/discussionMediaCache', async importOriginal => ({
  ...await importOriginal<typeof import('../media/discussionMediaCache')>(),
  storeDiscussionMedia: vi.fn(async () => undefined),
  readDiscussionMedia: vi.fn(async () => null),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const port = { ...fixture().port, supportsMedia: true, updateDraftMedia: vi.fn(async () => undefined) };
  const mockUpload = vi.mocked(uploadDirectMedia);
  const uploaded = (file: File, key: string): UploadedMedia => ({
    key, url: directMediaUrl(key) ?? '', contentType: file.type, sizeBytes: file.size, fileName: file.name,
  });
  const result = renderHook(() => {
    const draft = useDiscussionDraft(port, thread.id);
    return { draft, media: useDiscussionMedia(port, draft) };
  });
  return { port, mockUpload, uploaded, ...result };
}

it('publishes a recorded video-note on capture completion without a Send action', async () => {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => 'blob:video-note-preview'), revokeObjectURL: vi.fn(),
  }));
  const { result, port, mockUpload, uploaded } = setup();
  mockUpload.mockImplementation(async (file, options) => uploaded(file, options?.retryKey ?? ''));
  await waitFor(() => expect(result.current.draft.ready).toBe(true));

  act(() => {
    result.current.media.sendVideoNote({
      blob: new Blob(['circle bytes'], { type: 'video/webm' }),
      mimeType: 'video/webm', durationMs: 2400,
    });
  });
  await waitFor(() => expect(port.send).toHaveBeenCalledOnce());
  const command = vi.mocked(port.send).mock.calls[0][0];
  expect(command.draftMedia).toMatchObject({
    mediaType: 'video-note', mimeType: 'video/webm', durationSeconds: 2.4,
  });
  expect(mockUpload).toHaveBeenCalledOnce();
  await waitFor(() => expect(result.current.media.selection).toBeUndefined());
});

it('retains a failed automatic send for explicit retry with the same identity', async () => {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => 'blob:video-note-preview'), revokeObjectURL: vi.fn(),
  }));
  const { result, port, mockUpload, uploaded } = setup();
  mockUpload.mockRejectedValueOnce(new MediaUploadError('NETWORK'))
    .mockImplementation(async (file, options) => uploaded(file, options?.retryKey ?? ''));
  await waitFor(() => expect(result.current.draft.ready).toBe(true));

  act(() => result.current.media.sendVideoNote({
    blob: new Blob(['circle bytes'], { type: 'video/webm' }), mimeType: 'video/webm', durationMs: 2000,
  }));
  await waitFor(() => expect(result.current.media.phase).toBe('failed'));
  const firstKey = result.current.media.selection?.metadata.storageKey;
  expect(firstKey).toMatch(/^mvp-media\/[a-f0-9]{64}$/);
  expect(port.send).not.toHaveBeenCalled();

  await act(async () => { await result.current.media.send(); });
  expect(port.send).toHaveBeenCalledOnce();
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(mockUpload.mock.calls[1][1]?.retryKey).toBe(firstKey);
});

it('renders a media bubble using the existing compact circular player and expands on tap', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const view = render(<DiscussionVideoNote src="blob:video-note" durationSeconds={12} />);
  expect(view.container.querySelector('.discussion-video-note__circle.video-note-module__circle')).toBeTruthy();
  expect(view.container.querySelector('.video-note-playback--preview')).toBeTruthy();
  expect(view.container.querySelector('.video-note-playback__timeline')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Открыть видеокружок' }));
  expect(view.container.querySelector('.discussion-video-note[data-expanded]')).toBeTruthy();
  expect(screen.getByRole('slider', { name: 'Перемотка видеокружка' })).toBeTruthy();
});

it('keeps MessageBar empty for a restored video note and shows no attachment preview', async () => {
  const draft = { ...prepareDiscussionMessage(thread.id, ''), draftMedia: {
    id: 'circle', storageKey: 'mvp-media/' + 'a'.repeat(64), mediaType: 'video-note' as const,
    mimeType: 'video/mp4', sizeBytes: 10, durationSeconds: 5,
    fileName: 'Видеокружок.mp4', uploadState: 'failed' as const,
  } };
  const port = { ...fixture().port, supportsMedia: true, getDraft: vi.fn(async () => draft) };
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })}
    parentNavigation={null} onClose={() => {}} onNavigationContextChange={() => {}} /></KonstaProvider>);
  await screen.findByRole('button', { name: 'Отправить' });
  await waitFor(() => expect(view.container.querySelector('.discussion-composer__field textarea')).toHaveProperty('disabled', true));
  const field = view.container.querySelector('.discussion-composer__field');
  expect(field?.querySelector('textarea')?.placeholder).toBe('');
  expect(field?.querySelector('.video-note-playback')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Предпросмотр вложения' })).toBeNull();
});

it('renders published video-note metadata in a circular bubble, not a rectangular gallery viewer', async () => {
  const circle = { ...message('circle-message', ''), attachments: [{
    id: 'circle-attachment', messageId: 'circle-message', realmId: thread.realmId,
    owner: 'tg:1', authorUserId: 'tg:1', mediaType: 'video-note' as const, mimeType: 'video/mp4',
    sizeBytes: 10, durationSeconds: 5, storageKey: 'mvp-media/' + 'b'.repeat(64),
    uploadState: 'ready' as const, confirmedAt: thread.createdAt,
  }] };
  const port = fixture([circle]).port;
  const view = render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port}
    threadId={thread.id} anchor={anchor} resolveAuthor={id => ({ name: id })}
    parentNavigation={null} onClose={() => {}} onNavigationContextChange={() => {}} /></KonstaProvider>);
  await screen.findByRole('button', { name: 'Открыть видеокружок' });
  expect(view.container.querySelector('[data-message-id="circle-message"] .discussion-video-note__circle')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Открыть видео' })).toBeNull();
});
