// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { BlobSource, Input, MP4 } from 'mediabunny';
import { expect, it } from 'vitest';
import { prepareVideoExport } from './prepareVideoExport';

function recording() {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/video-trim-fragmented.mp4', import.meta.url)));
  return new File([bytes], 'Видео Mezfit.mp4', { type: 'video/mp4' });
}

it('writes the movie duration for a fragmented MP4 while preserving portrait video and audio', async () => {
  const original = recording();
  const { signal } = new AbortController();
  const exported = await prepareVideoExport(original, signal);
  expect(exported).not.toBe(original);
  expect(exported.name).toBe(original.name);
  const bytes = new Uint8Array(await exported.arrayBuffer());
  const header = bytes.findIndex((byte, index) => byte === 109 && bytes[index + 1] === 118
    && bytes[index + 2] === 104 && bytes[index + 3] === 100) + 4;
  expect(header).toBeGreaterThan(4);
  const view = new DataView(bytes.buffer);
  const extended = view.getUint8(header) === 1;
  const duration = extended ? Number(view.getBigUint64(header + 24)) : view.getUint32(header + 16);
  const timescale = view.getUint32(header + (extended ? 20 : 12));
  expect(duration / timescale).toBeGreaterThan(0);

  const input = new Input({ formats: [MP4], source: new BlobSource(original) });
  const output = new Input({ formats: [MP4], source: new BlobSource(exported) });
  try {
    expect(duration / timescale).toBeCloseTo(await input.computeDuration(), 1);
    const video = await output.getPrimaryVideoTrack();
    expect(await video?.getCodec()).toBe('avc');
    expect([await video?.getDisplayWidth(), await video?.getDisplayHeight()]).toEqual([32, 48]);
    expect(await (await output.getPrimaryAudioTrack())?.getCodec()).toBe('aac');
    expect(await prepareVideoExport(exported, signal)).toBe(exported);
  } finally {
    input.dispose();
    output.dispose();
  }
});
