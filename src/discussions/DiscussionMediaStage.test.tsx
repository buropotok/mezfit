// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionMediaStage } from './DiscussionMediaStage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function playback(fullscreen: boolean) {
  return <div data-testid="discussion-sheet">
    <DiscussionMediaStage label="Просмотр вложения" fullscreen={fullscreen}>
      <video aria-label="Видео" controls />
    </DiscussionMediaStage>
  </div>;
}

it('keeps the video and playback position when entering and leaving fullscreen', () => {
  const requestFullscreen = vi.fn();
  const exitFullscreen = vi.fn();
  vi.stubGlobal('Telegram', { WebApp: { requestFullscreen, exitFullscreen, isFullscreen: false } });
  const view = render(playback(false));
  const video = screen.getByLabelText('Видео');
  if (!(video instanceof HTMLVideoElement)) throw new Error('Expected a video element');
  video.currentTime = 4;

  view.rerender(playback(true));
  expect(screen.getByRole('dialog', { name: 'Просмотр вложения' }).contains(video)).toBe(true);
  expect(screen.getByTestId('discussion-sheet').contains(video)).toBe(false);
  expect(requestFullscreen).toHaveBeenCalledOnce();

  view.rerender(playback(false));
  expect(screen.getByLabelText('Видео')).toBe(video);
  expect(screen.getByTestId('discussion-sheet').contains(video)).toBe(true);
  expect(video.currentTime).toBe(4);
  expect(exitFullscreen).toHaveBeenCalledOnce();
});

it('opens the full viewport without a host fullscreen API', () => {
  vi.stubGlobal('Telegram', undefined);
  const view = render(playback(true));
  expect(screen.getByRole('dialog', { name: 'Просмотр вложения' })).toBeTruthy();
  expect(screen.getByTestId('discussion-sheet').contains(screen.getByLabelText('Видео'))).toBe(false);
  view.unmount();
  expect(screen.queryByRole('dialog', { name: 'Просмотр вложения' })).toBeNull();
});
