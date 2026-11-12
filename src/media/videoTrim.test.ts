// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { BlobSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';
import { inspectVideoTrim, trimRecordedMp4 } from './videoTrim';
import { encodeTrimStart } from './videoTrimAvc';

vi.mock('./videoTrimAvc', async importOriginal => {
  const actual = await importOriginal<typeof import('./videoTrimAvc')>();
  return { ...actual, encodeTrimStart: vi.fn(actual.encodeTrimStart) };
});

// A synthetic 32 × 48 AVC/AAC recording in fragmented MP4, with one keyframe per second.
const recording = () => new Blob([
  new Uint8Array(readFileSync(new URL('./fixtures/video-trim-fragmented.mp4', import.meta.url))),
], { type: 'video/mp4' });

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
  const trimmed = await trimRecordedMp4(original, info, { start: 1.1, end: 2.45 }, signal);
  const input = new Input({ formats: [MP4], source: new BlobSource(trimmed) });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    expect(await video?.getCodec()).toBe('avc');
    expect(await audio?.getCodec()).toBe('aac');
    expect([await video?.getDisplayWidth(), await video?.getDisplayHeight()]).toEqual([32, 48]);
    expect(await input.computeDuration()).toBeCloseTo(2.45 - 1.064, 1);
  } finally {
    input.dispose();
  }
});

it('encodes only the selected non-keyframe prefix and copies the remaining AVC frames and AAC', async () => {
  const original = recording();
  const { signal } = new AbortController();
  const info = await inspectVideoTrim(original, signal);
  const input = new Input({ formats: [MP4], source: new BlobSource(original) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('Missing fixture video');
  const sink = new EncodedPacketSink(track);
  const frame = await sink.getPacket(0.46);
  const join = await sink.getKeyPacket(1.1);
  if (!frame || !join) throw new Error('Missing fixture frames');
  expect(frame.type).toBe('delta');
  // Supply encoded frames from the fixture instead of requiring WebCodecs in Node.
  const samplePrefix = await trimRecordedMp4(original, info, { start: 0, end: join.timestamp - frame.timestamp }, signal);
  const encode = vi.mocked(encodeTrimStart);
  encode.mockClear();
  encode.mockImplementationOnce(() => samplePrefix.arrayBuffer());
  const trimmed = await trimRecordedMp4(original, info, { start: 0.46, end: 2.45 }, signal);
  expect(encode).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), frame.timestamp, join.timestamp, signal);
  const result = new Input({ formats: [MP4], source: new BlobSource(trimmed) });
  try {
    const resultVideo = await result.getPrimaryVideoTrack();
    if (!resultVideo) throw new Error('Missing trimmed video');
    const resultSink = new EncodedPacketSink(resultVideo);
    const copiedKeyframe = await resultSink.getKeyPacket(join.timestamp - frame.timestamp + 0.001);
    expect(copiedKeyframe?.timestamp).toBeCloseTo(join.timestamp - frame.timestamp, 3);
    expect(copiedKeyframe?.data.slice(-join.data.length)).toEqual(join.data);
    expect(await (await result.getPrimaryAudioTrack())?.getCodec()).toBe('aac');
    expect(await result.computeDuration()).toBeCloseTo(2.45 - frame.timestamp, 1);
  } finally {
    input.dispose();
    result.dispose();
  }
});
