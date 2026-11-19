// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVideoOrientation } from './useVideoOrientation';
import { readVideoOrientation, type VideoOrientation } from './videoOrientation';

vi.mock('./videoOrientation', async importOriginal => ({
  ...await importOriginal<typeof import('./videoOrientation')>(),
  readVideoOrientation: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function Player({ src }: { src?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const orientation = useVideoOrientation(ref, src, 'contain');
  return <video ref={ref} src={src} style={orientation.style} />;
}

function load(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: width },
    videoHeight: { configurable: true, value: height },
  });
  fireEvent.loadedMetadata(video);
}

it('renders before a source is available and waits for the resolved video metadata', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValue({ width: 480, height: 488, rotation: 90 });
  const { container, rerender } = render(<Player />);
  const video = container.querySelector('video')!;
  expect(video.style.transform).toBe('');
  expect(readVideoOrientation).not.toHaveBeenCalled();
  rerender(<Player src="blob:resolved" />);
  load(video, 480, 488);
  await waitFor(() => expect(video.style.transform).toContain('rotate(90deg)'));
});

it('does not read metadata or apply transforms for square recordings', () => {
  const { container } = render(<Player src="blob:square" />);
  const video = container.querySelector('video')!;
  load(video, 480, 480);
  expect(readVideoOrientation).not.toHaveBeenCalled();
  expect(video.style.transform).toBe('');
});

it('corrects the non-square frame once and cancels stale metadata on source change', async () => {
  let resolveOld: (value: VideoOrientation) => void = () => {};
  let oldSignal: AbortSignal | undefined;
  vi.mocked(readVideoOrientation).mockImplementationOnce((_src, signal) => {
    oldSignal = signal;
    return new Promise(resolve => { resolveOld = resolve; });
  }).mockResolvedValue({ width: 480, height: 488, rotation: 270 });
  const { container, rerender, unmount } = render(<Player src="blob:old" />);
  const video = container.querySelector('video')!;
  load(video, 480, 488);
  rerender(<Player src="blob:new" />);
  load(video, 480, 488);
  await waitFor(() => expect(video.style.transform).toContain('rotate(270deg)'));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => { resolveOld({ width: 480, height: 488, rotation: 90 }); });
  expect(video.style.transform).toContain('rotate(270deg)');
  unmount();
  expect(vi.mocked(readVideoOrientation).mock.calls[1][1].aborted).toBe(true);
});

it('preserves a browser-rotated frame and survives unavailable metadata', async () => {
  vi.mocked(readVideoOrientation).mockResolvedValueOnce({ width: 480, height: 488, rotation: 90 }).mockResolvedValue(null);
  const { container, rerender } = render(<Player src="blob:native" />);
  const video = container.querySelector('video')!;
  load(video, 488, 480);
  await waitFor(() => expect(readVideoOrientation).toHaveBeenCalledOnce());
  expect(video.style.transform).toBe('');
  rerender(<Player src="blob:unreadable" />);
  load(video, 480, 488);
  await waitFor(() => expect(readVideoOrientation).toHaveBeenCalledTimes(2));
  expect(video.style.transform).toBe('');
});
