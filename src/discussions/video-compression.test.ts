// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { compressGalleryVideo, videoCompressionSize } from './video-compression';

afterEach(() => vi.unstubAllGlobals());

it('downscales landscape and portrait video to an even 854px long side without upscaling', () => {
  expect(videoCompressionSize(3840, 2160)).toEqual({ width: 854, height: 480 });
  expect(videoCompressionSize(1080, 1920)).toEqual({ width: 480, height: 854 });
  expect(videoCompressionSize(640, 360)).toEqual({ width: 640, height: 360 });
  expect(videoCompressionSize(1, 1)).toEqual({ width: 2, height: 2 });
  expect(() => videoCompressionSize(0, 720)).toThrow();
});

it('does not attempt encoding small files, long clips or unsupported WebViews', async () => {
  const controller = new AbortController();
  const file = new File(['sample'], 'clip.mp4', { type: 'video/mp4' });
  const dimensions = { width: 1920, height: 1080, durationSeconds: 180 };
  expect(await compressGalleryVideo(file, dimensions, controller.signal)).toBeNull();
  Object.defineProperty(file, 'size', { value: 425 * 1024 * 1024 });
  vi.stubGlobal('MediaRecorder', undefined);
  expect(await compressGalleryVideo(file, dimensions, controller.signal)).toBeNull();
  expect(await compressGalleryVideo(file, { ...dimensions, durationSeconds: 181 }, controller.signal)).toBeNull();
  controller.abort();
  expect(await compressGalleryVideo(file, dimensions, controller.signal)).toBeNull();
});
