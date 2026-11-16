// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readDiscussionMedia, downloadDiscussionMedia } from '../media/discussionMediaCache';
import { DiscussionAttachmentSaveDialog, discussionAttachmentFileName } from './DiscussionVideoSaveDialog';
import type { MessageAttachment } from '../data/cloud/discussion-contracts';

vi.mock('../media/discussionMediaCache', () => ({
  readDiscussionMedia: vi.fn(),
  downloadDiscussionMedia: vi.fn(),
}));
const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
const canShareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'canShare');

afterEach(() => {
  cleanup(); vi.resetAllMocks();
  if (shareDescriptor) Object.defineProperty(navigator, 'share', shareDescriptor);
  else Reflect.deleteProperty(navigator, 'share');
  if (canShareDescriptor) Object.defineProperty(navigator, 'canShare', canShareDescriptor);
  else Reflect.deleteProperty(navigator, 'canShare');
});

it.each([
  ['photo', 'image/jpeg', 'Фото Mezfit.jpg', 'Сохранить фото'],
  ['photo', 'image/png', 'Фото Mezfit.png', 'Сохранить фото'],
  ['voice', 'audio/ogg', 'Голосовое Mezfit.ogg', 'Сохранить голосовое сообщение'],
  ['voice', 'audio/mp4', 'Голосовое Mezfit.m4a', 'Сохранить голосовое сообщение'],
  ['video-note', 'video/mp4', 'Видеокружок Mezfit.mp4', 'Сохранить видеокружок'],
  ['video', 'video/quicktime', 'Видео Mezfit.mov', 'Сохранить видео'],
] as const)('saves a %s attachment with correct MIME and filename', async (mediaType, mimeType, expectedName, title) => {
  expect(discussionAttachmentFileName(mediaType, mimeType)).toBe(expectedName);
  const blob = new Blob(['data'], { type: mimeType });
  vi.mocked(readDiscussionMedia).mockResolvedValue(blob);
  const share = vi.fn(async (_data: ShareData) => {});
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: () => true },
    share: { configurable: true, value: share },
  });
  const cache = { accountId: 'tg:1', storageKey: 'mvp-media/' + 'b'.repeat(64),
    mimeType, sizeBytes: blob.size, realmId: 'pair', messageId: 'received',
    attachmentId: 'received-file' };
  const onClose = vi.fn();
  const onStatus = vi.fn();
  render(<KonstaProvider theme="ios" dark><DiscussionAttachmentSaveDialog
    target={{ mediaType: mediaType as MessageAttachment['mediaType'], url: 'https://media.example.com/safe', cache }}
    onClose={onClose} onStatus={onStatus} /></KonstaProvider>);
  expect(screen.getByText(title)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(share).toHaveBeenCalledExactlyOnceWith({ files: [
    expect.objectContaining({ name: expectedName, type: mimeType, size: blob.size }),
  ] }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(downloadDiscussionMedia).not.toHaveBeenCalled();
});

it('can retrieve a received attachment through the existing authenticated fallback on a cache miss', async () => {
  const blob = new Blob(['file'], { type: 'audio/ogg' });
  vi.mocked(readDiscussionMedia).mockResolvedValue(null);
  vi.mocked(downloadDiscussionMedia).mockResolvedValue(blob);
  const share = vi.fn(async (_data: ShareData) => {});
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: () => true },
    share: { configurable: true, value: share },
  });
  const cache = { accountId: 'tg:1', storageKey: 'mvp-media/' + 'd'.repeat(64),
    mimeType: 'audio/ogg', sizeBytes: blob.size, realmId: 'pair',
    messageId: 'foreign-message', attachmentId: 'foreign-attachment' };
  const onClose = vi.fn();
  render(<KonstaProvider theme="ios" dark><DiscussionAttachmentSaveDialog
    target={{ mediaType: 'voice', url: 'https://media.example.com/source', cache }}
    onClose={onClose} onStatus={() => {}} /></KonstaProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(downloadDiscussionMedia).toHaveBeenCalledExactlyOnceWith(cache));
  expect(share).toHaveBeenCalledExactlyOnceWith({ files: [
    expect.objectContaining({ name: 'Голосовое Mezfit.ogg', type: 'audio/ogg' }),
  ] });
});

it('does not claim a download succeeded when a received attachment is unavailable', async () => {
  vi.mocked(readDiscussionMedia).mockResolvedValue(null);
  vi.mocked(downloadDiscussionMedia).mockResolvedValue(null);
  const onStatus = vi.fn(), onClose = vi.fn();
  render(<KonstaProvider theme="ios" dark><DiscussionAttachmentSaveDialog
    target={{ mediaType: 'photo', url: 'https://media.example.com/safe',
      cache: { accountId: 'tg:1', storageKey: 'mvp-media/' + 'c'.repeat(64),
        mimeType: 'image/jpeg', sizeBytes: 5, realmId: 'pair', messageId: 'received', attachmentId: 'a' } }}
    onClose={onClose} onStatus={onStatus} /></KonstaProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Скачать файл' }));
  expect(screen.getByRole('alert').textContent).toContain('Фото недоступно');
  expect(onStatus).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
