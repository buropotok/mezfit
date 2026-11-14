import { beforeEach, expect, it, vi } from 'vitest';
import { trimRecordedWebm } from './videoTrimWebm';

const state = vi.hoisted(() => ({
  conversions: [] as Array<{ copy: unknown; trim: unknown }>,
  failExact: false,
  failCopy: false,
}));

vi.mock('mediabunny', () => {
  class BufferTarget { buffer: ArrayBuffer | null = null; }
  class BlobSource { constructor(_blob: Blob) {} }
  class Input {
    constructor(_args: unknown) {}
    async getPrimaryVideoTrack() { return { getCodec: async () => 'vp8' }; }
    async computeDuration() { return 2; }
    dispose() {}
  }
  return {
    Input, BlobSource, WebM: {},
    WebMOutputFormat: class {},
    BufferTarget,
    Output: class {
      readonly target: BufferTarget;
      constructor(args: { target: BufferTarget }) { this.target = args.target; }
    },
    Conversion: {
      init: async (options: {
        copy: false | { mode: string; boundaryPolicy: string };
        trim: { start: number; end: number };
        output: { target: BufferTarget };
      }) => {
        state.conversions.push({ copy: options.copy, trim: options.trim });
        return {
          isValid: true, discardedTracks: [],
          execute: async () => {
            if (options.copy === false && state.failExact) throw new Error('Encoder unavailable');
            if (options.copy !== false && state.failCopy) throw new Error('Copy failed');
            options.output.target.buffer = new Uint8Array([1, 2, 3]).buffer;
          },
          cancel: async () => {},
        };
      },
    },
  };
});

const clip = () => new Blob(['webm-data'], { type: 'video/webm' });
const info = { duration: 3, timelineStart: 0.2 };
const selection = { start: 0.75, end: 2 };

beforeEach(() => {
  state.failExact = false;
  state.failCopy = false;
  state.conversions.length = 0;
});

it('performs exact WebM trim first, without notifying a fallback', async () => {
  const notify = vi.fn();
  const result = await trimRecordedWebm(clip(), info, selection, new AbortController().signal, notify);
  expect(result.mode).toBe('exact');
  expect(result.blob.type).toBe('video/webm');
  expect(state.conversions).toEqual([{ copy: false, trim: { start: 0.95, end: 2.2 } }]);
  expect(notify).not.toHaveBeenCalled();
});

it('notifies once and falls back to keyframe copying when WebCodecs encode fails', async () => {
  state.failExact = true;
  const notify = vi.fn();
  const result = await trimRecordedWebm(clip(), info, selection, new AbortController().signal, notify);
  expect(result.mode).toBe('keyframe');
  expect(notify).toHaveBeenCalledOnce();
  expect(state.conversions[0].copy).toBe(false);
  expect(state.conversions[1].copy).toEqual({
    mode: 'forced', boundaryPolicy: 'shrink', boundaryTolerance: Infinity, shiftTolerance: Infinity,
  });
});

it('does not deliver a partial video when both exact and keyframe paths fail', async () => {
  state.failExact = true;
  state.failCopy = true;
  await expect(trimRecordedWebm(clip(), info, selection, new AbortController().signal))
    .rejects.toThrow('WEBM_KEYFRAME_TRIM_UNAVAILABLE');
});

it('keeps the original untouched when the full recording is selected', async () => {
  const original = clip();
  const result = await trimRecordedWebm(original, info, { start: 0, end: info.duration }, new AbortController().signal);
  expect(result.blob).toBe(original);
  expect(state.conversions).toHaveLength(0);
});
