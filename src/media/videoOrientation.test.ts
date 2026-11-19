// @ts-expect-error Production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { missingVideoRotation, readVideoOrientation, rotatedVideoScale } from './videoOrientation';

it.each([90, 270])('compensates missing %s° rotation and leaves native rotation intact', rotation => {
  const track = { width: 480, height: 488, rotation };
  expect(missingVideoRotation(480, 488, track)).toBe(rotation);
  expect(missingVideoRotation(488, 480, track)).toBe(0);
});

it('skips square, unknown-size, unrotated and ambiguous half-turn frames', () => {
  expect(missingVideoRotation(480, 480, { width: 480, height: 480, rotation: 90 })).toBe(0);
  expect(missingVideoRotation(0, 0, { width: 480, height: 488, rotation: 90 })).toBe(0);
  expect(missingVideoRotation(240, 244, { width: 480, height: 488, rotation: 90 })).toBe(0);
  for (const rotation of [0, 180]) {
    expect(missingVideoRotation(480, 488, { width: 480, height: 488, rotation })).toBe(0);
  }
});

it('fits the rotated frame inside an ordinary viewer and fills a circular crop', () => {
  expect(rotatedVideoScale(720, 1280, 1280, 720, 'contain')).toBeCloseTo(1280 / 720);
  expect(rotatedVideoScale(720, 1280, 1280, 720, 'cover')).toBeCloseTo(720 / 1280);
  expect(rotatedVideoScale(300, 300, 480, 488, 'cover')).toBe(1);
  expect(rotatedVideoScale(0, 0, 480, 488, 'contain')).toBe(1);
});

it.each([90, 270])('reads the actual %s° tkhd matrix from fragmented MP4 without decoding', async rotation => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/video-trim-fragmented.mp4', import.meta.url)));
  const marker = new TextDecoder('latin1').decode(bytes).indexOf('tkhd');
  expect(marker).toBeGreaterThan(0);
  const body = marker + 4;
  const matrix = body + (bytes[body] === 1 ? 52 : 40);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = rotation === 90
    ? [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824]
    : [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824];
  values.forEach((value, index) => view.setInt32(matrix + index * 4, value));
  const url = `data:video/mp4;base64,${btoa(String.fromCharCode(...bytes))}`;
  expect(await readVideoOrientation(url, new AbortController().signal)).toEqual({ width: 32, height: 48, rotation });
});

it('leaves playback available when metadata is malformed or reading is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await readVideoOrientation('data:video/mp4;base64,AAAA', controller.signal)).toBeNull();
  expect(await readVideoOrientation('data:video/mp4;base64,AAAA', new AbortController().signal)).toBeNull();
});
