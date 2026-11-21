import { expect, it } from 'vitest';
import { discussionVideoDimensions, discussionVideoNeedsCompression } from './discussionVideoPreparation';

const MiB = 1024 * 1024;

it.each([
  [3840, 2160, 1280, 720],
  [2160, 3840, 720, 1280],
  [1080, 1080, 720, 720],
  [1920, 800, 1280, 532],
  [640, 360, 640, 360],
])('fits %i × %i into %i × %i without upscaling', (width, height, outputWidth, outputHeight) => {
  expect(discussionVideoDimensions(width, height)).toEqual({ width: outputWidth, height: outputHeight });
});

it('keeps economical 720p recordings and compresses large, high-resolution or high-frame-rate video', () => {
  expect(discussionVideoNeedsCompression(1280, 720, 30, 20 * MiB, 180)).toBe(false);
  expect(discussionVideoNeedsCompression(720, 1280, 30, 200 * MiB, 180)).toBe(true);
  expect(discussionVideoNeedsCompression(1920, 1080, 30, 2 * MiB, 20)).toBe(true);
  expect(discussionVideoNeedsCompression(1280, 720, 60, 5 * MiB, 15)).toBe(true);
});
