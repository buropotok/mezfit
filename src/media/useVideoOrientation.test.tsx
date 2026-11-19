// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoOrientation } from './useVideoOrientation';
import { readVideoOrientation, type VideoOrientation } from './videoOrientation';
import { loadVideoPlaybackCopy } from './videoPlaybackCopy';

vi.mock('./videoOrientation', async importOriginal => ({
  ...await importOriginal<typeof import('./videoOrientation')>(), readVideoOrientation: vi.fn(),
}));
vi.mock('./videoPlaybackCopy', () => ({ loadVideoPlaybackCopy: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:neutral');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(loadVideoPlaybackCopy).mockResolvedValue(new Blob(['copy'], { type: 'video/mp4' }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function Player({ src }: { src?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const orientation = useVideoOrientation(ref, src, 'contain');
  return <><video ref={ref} src={orientation.src} style={orientation.style} />
    {orientation.error && <span role="alert">{orientation.error}</span>}</>;
}
function load(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: width }, videoHeight: { configurable: true, value: height },
  });
  fireEvent.loadedMetadata(video);
}

it('waits for a source and decoded metadata before inspecting orientation', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation: 90 });
  const { container, rerender } = render(<Player />);
  const video = container.querySelector('video')!;
  expect(readVideoOrientation).not.toHaveBeenCalled();
  rerender(<Player src="blob:original" />);
  expect(video.style.visibility).toBe('hidden');
  load(video, 480, 480);
  await waitFor(() => expect(video.getAttribute('src')).toBe('blob:neutral'));
  expect(video.style.transform).toContain('rotate(90deg)');
  expect(video.style.visibility).toBe('hidden');
  fireEvent.loadedData(video);
  await waitFor(() => expect(video.style.visibility).toBe(''));
});

it.each([90, 180, 270])('normalizes square video with %s° metadata and revokes its copy', async rotation => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation });
  const { container, unmount } = render(<Player src="blob:square" />);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  await waitFor(() => expect(video.style.transform).toContain(`rotate(${rotation}deg)`));
  expect(loadVideoPlaybackCopy).toHaveBeenCalledWith('blob:square', expect.any(AbortSignal));
  expect(video.getAttribute('src')).toBe('blob:neutral');
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:neutral');
});

it('uses a neutral copy even when the browser reports already-rotated dimensions', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation: 90 });
  const { container } = render(<Player src="blob:original" />);
  const video = container.querySelector('video')!;
  load(video, 488, 480);
  await waitFor(() => expect(video.getAttribute('src')).toBe('blob:neutral'));
  expect(video.style.transform).toContain('rotate(90deg)');
});

it('cancels stale reads and never lets them replace the new source', async () => {
  let resolveOld: (value: VideoOrientation) => void = () => {};
  let signal: AbortSignal | undefined;
  vi.mocked(readVideoOrientation).mockImplementationOnce((_src, inputSignal) => {
    signal = inputSignal;
    return new Promise(resolve => { resolveOld = resolve; });
  }).mockResolvedValue({ width: 480, height: 480, rotation: 270 });
  const { container, rerender } = render(<Player src="blob:old" />);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  rerender(<Player src="blob:new" />);
  load(video, 480, 480);
  await waitFor(() => expect(video.style.transform).toContain('rotate(270deg)'));
  expect(signal?.aborted).toBe(true);
  await act(async () => { resolveOld({ width: 480, height: 480, rotation: 90 }); });
  expect(loadVideoPlaybackCopy).toHaveBeenCalledTimes(1);
  expect(video.style.transform).toContain('rotate(270deg)');
});

it('keeps zero-angle sources unchanged and does not download a full copy', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation: 0 });
  const { container } = render(<Player src="blob:upright" />);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  await waitFor(() => expect(video.style.visibility).toBe(''));
  expect(video.getAttribute('src')).toBe('blob:upright');
  expect(loadVideoPlaybackCopy).not.toHaveBeenCalled();
});

it('keeps the original hidden and reports preparation failures', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation: 90 });
  vi.mocked(loadVideoPlaybackCopy).mockRejectedValue(new Error('copy failed'));
  const { container } = render(<Player src="blob:broken" />);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  await screen.findByRole('alert');
  expect(video.style.visibility).toBe('hidden');
});

it('aborts preparation at its deadline and keeps the uncorrected frame hidden', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.mocked(readVideoOrientation).mockImplementation((_src, inputSignal) => {
    signal = inputSignal;
    return new Promise(() => {});
  });
  const { container } = render(<Player src="blob:slow" />);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(video.style.visibility).toBe('hidden');
});

it('does not create an object URL when a copy resolves after unmount', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 480, rotation: 90 });
  let finish: (value: Blob) => void = () => {};
  vi.mocked(loadVideoPlaybackCopy).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { container, unmount } = render(<Player src="blob:closing" />);
  load(container.querySelector('video')!, 480, 480);
  await waitFor(() => expect(loadVideoPlaybackCopy).toHaveBeenCalledOnce());
  unmount();
  await act(async () => { finish(new Blob(['late'])); });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
