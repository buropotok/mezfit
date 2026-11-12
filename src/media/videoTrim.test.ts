// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { BlobSource, Input, MP4 } from 'mediabunny';
import { inspectVideoTrim, nearestTrimStart, trimRecordedMp4 } from './videoTrim';

// A synthetic 32 × 48 AVC/AAC recording in fragmented MP4, with one keyframe per second.
const recording = () => new Blob([
  new Uint8Array(readFileSync(new URL('./fixtures/video-trim-fragmented.mp4', import.meta.url))),
], { type: 'video/mp4' });

it('snaps the start to a keyframe that leaves a playable range', () => {
  expect(nearestTrimStart([0, 1, 2], 1.7, 2.05)).toBe(1);
  expect(nearestTrimStart([0, 1, 2], 1.7, 3)).toBe(2);
});

it('keeps the original when the entire video is selected', async () => {
  const original = recording();
  const { signal } = new AbortController();
  const info = await inspectVideoTrim(original, signal);
  expect(await trimRecordedMp4(original, info, { start: 0, end: info.duration }, signal)).toBe(original);
});

it('copies a shorter MP4 with sound, the same codecs, and the original portrait proportions', async () => {
  const original = recording();
  const { signal } = new AbortController();
  const info = await inspectVideoTrim(original, signal);
  const start = nearestTrimStart(info.keyframes, 1.1, 2.45);
  expect(start).toBeCloseTo(1.064, 2);
  const trimmed = await trimRecordedMp4(original, info, { start, end: 2.45 }, signal);
  const input = new Input({ formats: [MP4], source: new BlobSource(trimmed) });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    expect(await video?.getCodec()).toBe('avc');
    expect(await audio?.getCodec()).toBe('aac');
    expect([await video?.getDisplayWidth(), await video?.getDisplayHeight()]).toEqual([32, 48]);
    expect(await input.computeDuration()).toBeCloseTo(2.45 - start, 1);
  } finally {
    input.dispose();
  }
});
