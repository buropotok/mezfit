// @ts-expect-error Production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readVideoOrientation, rotatedVideoScale } from './videoOrientation';

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

it('reports unavailable metadata when input is malformed or reading is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await readVideoOrientation('data:video/mp4;base64,AAAA', controller.signal)).toBeNull();
  expect(await readVideoOrientation('data:video/mp4;base64,AAAA', new AbortController().signal)).toBeNull();
});
