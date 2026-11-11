// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionVideoSaveDialog, type DiscussionVideoSaveTarget } from './DiscussionVideoSaveDialog';

vi.mock('../media/discussionMediaCache', () => ({
  readDiscussionMedia: vi.fn(async () => null),
  downloadDiscussionMedia: vi.fn(async () => null),
}));

const canShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');
const share = Object.getOwnPropertyDescriptor(navigator, 'share');
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (canShare) Object.defineProperty(navigator, 'canShare', canShare);
  else Reflect.deleteProperty(navigator, 'canShare');
  if (share) Object.defineProperty(navigator, 'share', share);
  else Reflect.deleteProperty(navigator, 'share');
});

function open(target: DiscussionVideoSaveTarget) {
  const onClose = vi.fn();
  const onStatus = vi.fn();
  render(<KonstaProvider theme="ios" dark>
    <DiscussionVideoSaveDialog target={target} onClose={onClose} onStatus={onStatus} />
  </KonstaProvider>);
  return { onClose, onStatus };
}

it('reports cancellation in the dialog without starting a download', async () => {
  const systemShare = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: () => true },
    share: { configurable: true, value: systemShare },
  });
  const { onClose, onStatus } = open({ file: new File(['video'], 'Запись.mp4', { type: 'video/mp4' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Сохранение отменено. Видео осталось в чате.')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(onStatus).not.toHaveBeenCalled();
});

it('waits for Telegram to confirm the download request before closing', async () => {
  const downloadFile = vi.fn<(_params: { url: string; file_name: string }, callback: (accepted: boolean) => void) => void>();
  vi.stubGlobal('Telegram', { WebApp: { downloadFile, isVersionAtLeast: () => true } });
  const url = 'https://storage.example.com/video';
  const { onClose, onStatus } = open({ url,
    cache: { accountId: 'tg:1', storageKey: 'video', mimeType: 'video/mp4', sizeBytes: 5 } });

  fireEvent.click(await screen.findByRole('button', { name: 'Скачать файл' }));
  expect(downloadFile).toHaveBeenCalledExactlyOnceWith({ url, file_name: 'Видео Mezfit.mp4' }, expect.any(Function));
  expect(onClose).not.toHaveBeenCalled();
  act(() => downloadFile.mock.calls[0][1](true));
  expect(onStatus).toHaveBeenCalledWith('Запрос принят Telegram. Ищите «Видео Mezfit.mp4» в загрузках.');
  expect(onClose).toHaveBeenCalledOnce();
});
