// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { KonstaProvider } from 'konsta/react';
import type { DiscussionMediaDraft } from '../data/cloud/discussion-media';
import { DiscussionOutgoingMedia } from './DiscussionOutgoingMedia';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const voice: DiscussionMediaDraft = {
  id: 'local-voice', storageKey: 'mvp-media/' + 'a'.repeat(64), mediaType: 'voice',
  mimeType: 'audio/mp4', sizeBytes: 12, durationSeconds: 2, waveform: [0.3, 0.7],
  fileName: 'Голосовое.m4a', uploadState: 'failed',
};
const circle: DiscussionMediaDraft = {
  id: 'local-circle', storageKey: 'mvp-media/' + 'b'.repeat(64), mediaType: 'video-note',
  mimeType: 'video/mp4', sizeBytes: 20, durationSeconds: 2,
  fileName: 'Кружок.mp4', uploadState: 'failed',
};
const createdAt = '2026-11-16T02:30:00.000Z';

it('replaces the voice play button with cancellation during upload, without overlapping controls', () => {
  const onCancel = vi.fn();
  const view = render(<KonstaProvider theme="ios" dark><DiscussionOutgoingMedia src="blob:local-voice"
    attachment={voice} createdAt={createdAt} status="uploading"
    onCancel={onCancel} onRemove={vi.fn()} onRetry={vi.fn()} /></KonstaProvider>);
  expect(screen.getAllByRole('button', { name: 'Отменить загрузку' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Воспроизвести голосовое сообщение' })).toBeNull();
  expect(view.container.querySelector('.discussion-outgoing__cancel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Отменить загрузку' }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it.each([voice, circle])('keeps failed $mediaType playable, and places red cancel next to retry', attachment => {
  const onRemove = vi.fn(), onRetry = vi.fn();
  const view = render(<KonstaProvider theme="ios" dark><DiscussionOutgoingMedia src="blob:local-media"
    attachment={attachment} createdAt={createdAt} status="failed"
    error="Mezfit облако недоступно" onCancel={vi.fn()} onRemove={onRemove} onRetry={onRetry} /></KonstaProvider>);
  expect(view.container.querySelector('.discussion-outgoing__preview')?.hasAttribute('data-playable')).toBe(true);
  expect(view.container.querySelector('.discussion-outgoing__cancel')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ещё раз' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Отменить' })).toBeTruthy();
  if (attachment.mediaType === 'voice') {
    expect(screen.getByRole('button', { name: 'Воспроизвести голосовое сообщение' })).toBeTruthy();
  } else {
    expect(screen.getByRole('button', { name: 'Открыть видеокружок' })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Ещё раз' }));
  fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(onRemove).toHaveBeenCalledOnce();
});

it('offers cancellation even when the cached file cannot be restored', () => {
  render(<KonstaProvider theme="ios" dark><DiscussionOutgoingMedia attachment={circle}
    createdAt={createdAt} status="failed" error="Локальный файл недоступен"
    onCancel={vi.fn()} onRemove={vi.fn()} onRetry={vi.fn()} /></KonstaProvider>);
  expect(screen.getByRole('button', { name: 'Ещё раз' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Отменить' })).toHaveProperty('disabled', false);
});
