// @ts-expect-error Production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlobSource, EncodedPacketSink, Input, MP4, WEBM } from 'mediabunny';
import { normalizeVideoPlayback } from './videoPlaybackCopy';

beforeEach(() => {
  class ForbiddenCodec { constructor() { throw new Error('Playback must never decode or encode media'); } }
  for (const name of ['VideoEncoder', 'AudioEncoder', 'VideoDecoder', 'AudioDecoder']) vi.stubGlobal(name, ForbiddenCodec);
});
afterEach(() => vi.unstubAllGlobals());

function recording(rotation: number, flip = false) {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/video-trim-fragmented.mp4', import.meta.url)));
  const body = new TextDecoder('latin1').decode(bytes).indexOf('tkhd') + 4;
  const matrix = body + (bytes[body] === 1 ? 52 : 40);
  const [a, b, c, d] = rotation === 90 ? [0, 65536, -65536, 0]
    : rotation === 270 ? [0, -65536, 65536, 0]
      : rotation === 180 ? [-65536, 0, 0, -65536] : [65536, 0, 0, 65536];
  const values = [flip ? -a : a, b, 0, flip ? -c : c, d, 0, 0, 0, 1073741824];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  values.forEach((value, index) => view.setInt32(matrix + index * 4, value));
  return new Blob([bytes], { type: 'video/mp4' });
}

async function inspect(blob: Blob) {
  const input = new Input({ formats: [MP4, WEBM], source: new BlobSource(blob) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('No video track');
    const packets: number[][][] = [];
    for (const track of await input.getTracks()) {
      const data: number[][] = [];
      for await (const packet of new EncodedPacketSink(track).packets()) data.push(Array.from(packet.data));
      packets.push(data);
    }
    return { rotation: await video.getRotation(), flip: await video.getFlip(), packets };
  } finally { input.dispose(); }
}

it.each([0, 90, 180, 270])('neutralizes %s° MP4 metadata with identical video and audio packets', async rotation => {
  const original = recording(rotation);
  const before = await inspect(original);
  expect(before.rotation).toBe(rotation);
  const copy = await normalizeVideoPlayback(original, new AbortController().signal);
  const after = await inspect(copy);
  expect(after.rotation).toBe(0);
  expect(after.flip).toBe(false);
  expect(after.packets).toEqual(before.packets);
  expect((await inspect(original)).rotation).toBe(rotation);
});

it('also removes mirrored rotation without decoding or encoding', async () => {
  const original = recording(90, true);
  const before = await inspect(original);
  expect(before.flip).toBe(true);
  const copy = await normalizeVideoPlayback(original, new AbortController().signal);
  const after = await inspect(copy);
  expect(after.rotation).toBe(0);
  expect(after.flip).toBe(false);
  expect(after.packets).toEqual(before.packets);
});

// Synthetic 32×48 VP8 clip generated with ffmpeg color + libvpx; no user media.
const webm = () => new Blob([Uint8Array.from(atob('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIZEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggID7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAeQAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIJ5ci3YYb2m+cgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgSC6gTCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAzc3PWY8CLY8WIJ5ci3YYb2m9nyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjQwMDAwMDAwMAAfQ7Z12+eBAKO/gQAAgDADAJ0BKiAAMAAARwiFhYiFhIgCAgJ1qgP4A/oCB8bwKnBA/v1u8//jmTcwxP+Obf/xYTwOKMj/8VEAo5WBAMgAsQEABRCsABgAGFgv9AAIiAAcU7trkbuPs4EAt4r3gQHxggGj8IED'), char => char.charCodeAt(0))], { type: 'video/webm' });

it('retains WebM format and its compressed video packets', async () => {
  const original = webm();
  const before = await inspect(original);
  const copy = await normalizeVideoPlayback(original, new AbortController().signal);
  expect(copy.type).toBe('video/webm');
  expect(await inspect(copy)).toEqual(before);
});

it('rejects cancelled preparation instead of publishing a partial copy', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(normalizeVideoPlayback(recording(90), controller.signal)).rejects.toThrow();
});
