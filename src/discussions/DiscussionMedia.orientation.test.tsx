// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionMedia } from './DiscussionMedia';
import { CircularVideoPlayback } from '../settings/CircularVideoPlayback';
import { readVideoOrientation } from '../media/videoOrientation';
import * as annotation from './discussion-annotation';

vi.mock('./useDiscussionMediaSource', () => ({
  useDiscussionMediaSource: (src: string) => ({ url: src, container: undefined, tryR2Fallback: vi.fn() }),
}));
vi.mock('../media/videoOrientation', async importOriginal => ({
  ...await importOriginal<typeof import('../media/videoOrientation')>(),
  readVideoOrientation: vi.fn(),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

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

it('corrects ordinary video while keeping playback and seeking controls upright', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation: 90 });
  const { container } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:video" type="video" mode="viewer" />
  </KonstaProvider>);
  const video = container.querySelector('video')!;
  expect(video.controls).toBe(true);
  load(video, 480, 488);
  await waitFor(() => expect(video.style.transform).toContain('rotate(90deg)'));
  expect(video.controls).toBe(false);
  const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Воспроизвести' }));
  expect(play).toHaveBeenCalledOnce();
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
  fireEvent.click(screen.getByRole('button', { name: 'Рисовать на изображении' }));
  expect(copy).toHaveBeenCalledWith(video, 90);
  expect(onAnnotate).toHaveBeenCalledWith(image, 0);
});

it('preserves native controls for already-correct and square videos', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation: 90 });
  const { container, rerender } = render(<KonstaProvider theme="ios" dark>
    <DiscussionMedia src="blob:correct" type="video" mode="viewer" />
  </KonstaProvider>);
  const video = container.querySelector('video')!;
  load(video, 488, 480);
  await waitFor(() => expect(readVideoOrientation).toHaveBeenCalledOnce());
  expect(video.style.transform).toBe('');
  expect(video.controls).toBe(true);
  rerender(<KonstaProvider theme="ios" dark><DiscussionMedia src="blob:square" type="video" mode="viewer" /></KonstaProvider>);
  load(video, 480, 480);
  expect(readVideoOrientation).toHaveBeenCalledOnce();
  expect(video.controls).toBe(true);
});
