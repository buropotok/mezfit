// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { DiscussionSheet } from './DiscussionSheet';
import { anchor, fixture, message, thread } from './discussion-fixture.test-support';
import { inspectDiscussionMedia } from './discussion-media-file';

vi.mock('./discussion-media-file', () => ({ inspectDiscussionMedia: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function renderDiscussion(port: ReturnType<typeof fixture>['port']) {
  return render(<KonstaProvider theme="ios" dark><DiscussionSheet opened repository={port} threadId={thread.id}
    anchor={anchor} resolveAuthor={id => ({ name: id })} onClose={() => {}} parentNavigation={null}
    onNavigationContextChange={() => {}} /></KonstaProvider>);
}

function playerIn(label: string) {
  const video = screen.getByLabelText(label).querySelector('video');
  if (!video) throw new Error('Video player not found');
  return video;
}

it('changes viewer speed through the gauge menu and retains the same video in fullscreen', async () => {
  const original = { ...message('video', ''), attachments: [{
    id: 'attachment', messageId: 'video', realmId: thread.realmId, owner: 'tg:1', authorUserId: 'tg:1',
    mediaType: 'video' as const, mimeType: 'video/mp4', sizeBytes: 10, durationSeconds: 12,
    storageKey: 'mvp-media/' + 'a'.repeat(64), uploadState: 'ready' as const, confirmedAt: thread.createdAt,
  }] };
  renderDiscussion(fixture([original]).port);
  fireEvent.click(await screen.findByRole('link', { name: 'Открыть видео' }));
  const video = playerIn('Просмотр вложения');
  video.currentTime = 4.25;
  expect(video.playbackRate).toBe(1);
  const gauge = screen.getByRole('button', { name: 'Скорость воспроизведения' });
  const fullscreen = screen.getByRole('button', { name: 'Во весь экран' });
  expect(Boolean(gauge.compareDocumentPosition(fullscreen) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

  fireEvent.click(gauge);
  for (const label of ['0.25×', '0.5×', '0.75×', '1×', '1.5×', '2×']) {
    expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('menuitem', { name: '0.5×' }));
  await waitFor(() => expect(video.playbackRate).toBe(0.5));
  expect(video.currentTime).toBe(4.25);

  fireEvent.click(fullscreen);
  expect(screen.getByRole('dialog', { name: 'Просмотр вложения' }).contains(video)).toBe(true);
  expect(video.playbackRate).toBe(0.5);
  fireEvent.click(screen.getByRole('button', { name: 'Скорость воспроизведения' }));
  const selected = await screen.findByRole('menuitem', { name: '0.5×' });
  expect(selected.className).toContain('ui-menu-item--active');
  fireEvent.click(screen.getByRole('menuitem', { name: '2×' }));
  await waitFor(() => expect(video.playbackRate).toBe(2));

  fireEvent.click(screen.getByRole('button', { name: 'Выйти из полноэкранного режима' }));
  expect(screen.getByRole('region', { name: 'Просмотр вложения' }).contains(video)).toBe(true);
  expect(video.playbackRate).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Открыть видео' }));
  const reopened = playerIn('Просмотр вложения');
  expect(reopened).not.toBe(video);
  expect(reopened.playbackRate).toBe(1);
});

it('offers the same speed control for video preview and preserves speed through fullscreen', async () => {
  const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
  const metadata: DiscussionMediaDraft = {
    id: 'preview-attachment', storageKey: 'mvp-media/' + 'b'.repeat(64),
    mediaType: 'video', mimeType: 'video/mp4', sizeBytes: file.size, durationSeconds: 8,
    fileName: file.name, uploadState: 'uploading',
  };
  vi.mocked(inspectDiscussionMedia).mockResolvedValue({ file, metadata });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:preview-speed');
    static revokeObjectURL = vi.fn();
  });
  const port = { ...fixture().port, supportsMedia: true };
  const view = renderDiscussion(port);
  const input = view.baseElement.querySelector('input[type="file"]');
  if (!input) throw new Error('Gallery picker not found');
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole('region', { name: 'Предпросмотр вложения' });
  const video = playerIn('Предпросмотр вложения');
  fireEvent.click(screen.getByRole('button', { name: 'Скорость воспроизведения' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '1.5×' }));
  await waitFor(() => expect(video.playbackRate).toBe(1.5));
  fireEvent.click(screen.getByRole('button', { name: 'Во весь экран' }));
  expect(screen.getByRole('dialog', { name: 'Предпросмотр вложения' }).contains(video)).toBe(true);
  expect(video.playbackRate).toBe(1.5);
});
