// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiscussionMedia } from './DiscussionMedia';
import { CircularVideoPlayback } from '../settings/CircularVideoPlayback';
import { readVideoOrientation } from '../media/videoOrientation';
import * as annotation from './discussion-annotation';
import { loadVideoPlaybackCopy } from '../media/videoPlaybackCopy';

vi.mock('./useDiscussionMediaSource', () => ({
  useDiscussionMediaSource: (src: string) => ({ url: src, container: undefined, tryR2Fallback: vi.fn() }),
}));
vi.mock('../media/videoOrientation', async importOriginal => ({
  ...await importOriginal<typeof import('../media/videoOrientation')>(),
  readVideoOrientation: vi.fn(),
}));
vi.mock('../media/videoPlaybackCopy', () => ({ loadVideoPlaybackCopy: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:neutral');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(loadVideoPlaybackCopy).mockResolvedValue(new Blob(['copy'], { type: 'video/mp4' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

function load(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: width },
    videoHeight: { configurable: true, value: height },
    duration: { configurable: true, value: 10 },
  });
  fireEvent.loadedMetadata(video);
}

it('renders photo attachments without trying to inspect video orientation', () => {
  render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:photo" type="photo" mode="thumbnail" />
  </KonstaProvider>);
  expect(screen.getByRole('link', { name: 'Открыть фото' })).toBeTruthy();
  expect(screen.getByAltText('Фото во вложении').getAttribute('src')).toBe('blob:photo');
  expect(readVideoOrientation).not.toHaveBeenCalled();
});

it.each([0, 90])('uses the same playback and seek controls with rotation %i', async rotation => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation });
  const { container } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:video" type="video" mode="viewer" />
  </KonstaProvider>);
  const video = container.querySelector('video')!;
  const playButton = screen.getByRole('button', { name: 'Воспроизвести' });
  expect(video.controls).toBe(false);
  load(video, 480, 488);
  await waitFor(() => expect(video.getAttribute('src')).toBe(rotation ? 'blob:neutral' : 'blob:video'));
  if (rotation) expect(video.style.transform).toContain('rotate(90deg)');
  else await waitFor(() => expect(video.style.visibility).toBe(''));
  expect(screen.getByRole('button', { name: 'Воспроизвести' })).toBe(playButton);
  const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
  expect(play).toHaveBeenCalledOnce();
  vi.spyOn(video, 'paused', 'get').mockReturnValue(false);
  fireEvent.play(video);
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
  expect(pause).toHaveBeenCalledOnce();
  fireEvent.input(screen.getByRole('slider', { name: 'Перемотка видео' }), { target: { value: '50' } });
  expect(video.currentTime).toBe(5);
});

it('uses the same correction for circular playback without changing its tap control', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation: 270 });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const { container } = render(<CircularVideoPlayback src="blob:circle" fallbackDuration={10} onError={vi.fn()} />);
  const video = container.querySelector('video')!;
  load(video, 480, 488);
  await waitFor(() => expect(video.style.transform).toContain('rotate(270deg)'));
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

it('passes the missing rotation when copying a compensated video frame for annotation', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation: 90 });
  const image = document.createElement('canvas');
  const copy = vi.spyOn(annotation, 'copyAnnotationImage').mockReturnValue(image);
  const onAnnotate = vi.fn();
  const { container } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:rotated" type="video" mode="viewer" onAnnotate={onAnnotate} />
  </KonstaProvider>);
  const video = container.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
  load(video, 480, 488);
  await waitFor(() => expect(video.style.transform).toContain('rotate(90deg)'));
  fireEvent.loadedData(video);
  await waitFor(() => expect(video.style.visibility).toBe(''));
  fireEvent.click(screen.getByRole('button', { name: 'Рисовать на изображении' }));
  expect(copy).toHaveBeenCalledWith(video, 90);
  expect(onAnnotate).toHaveBeenCalledWith(image, 0);
});

it('shows the playback panel in the attachment preview', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation: 0 });
  const { container, rerender } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:correct" type="video" mode="preview" />
  </KonstaProvider>);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  await waitFor(() => expect(readVideoOrientation).toHaveBeenCalledOnce());
  expect(video.style.transform).toBe('');
  expect(screen.getByRole('slider', { name: 'Перемотка видео' })).toBeTruthy();
  rerender(<KonstaProvider theme="ios" dark><DiscussionMedia src="blob:square" type="video" mode="viewer" /></KonstaProvider>);
  load(video, 480, 480);
  await waitFor(() => expect(readVideoOrientation).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('slider', { name: 'Перемотка видео' })).toBeTruthy();
});

it('shows a normalized square thumbnail with the same angle as the viewer', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation: 90 });
  const { container, rerender } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:square" type="video" mode="thumbnail" />
  </KonstaProvider>);
  const video = container.querySelector('video')!;
  expect(screen.queryByRole('slider', { name: 'Перемотка видео' })).toBeNull();
  load(video, 480, 480);
  await waitFor(() => expect(video.getAttribute('src')).toBe('blob:neutral'));
  expect(video.style.transform).toContain('rotate(90deg)');
  rerender(<KonstaProvider theme="ios" dark><DiscussionMedia src="blob:square" type="video" mode="viewer" /></KonstaProvider>);
  const viewer = container.querySelector('video')!;
  load(viewer, 480, 480);
  await waitFor(() => expect(viewer.getAttribute('src')).toBe('blob:neutral'));
  expect(viewer.style.transform).toContain('rotate(90deg)');
});
