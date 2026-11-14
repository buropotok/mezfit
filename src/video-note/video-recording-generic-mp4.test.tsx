// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoNoteRecorder } from './useVideoNoteRecorder';

const media = vi.hoisted(() => ({ codec: 'avc' }));
vi.mock('mediabunny', () => ({
  MP4: {},
  BlobSource: class { constructor(_blob: Blob) {} },
  Input: class {
    constructor(_options: unknown) {}
    async getPrimaryVideoTrack() { return { getCodec: async () => media.codec }; }
    dispose() {}
  },
}));

class GenericMp4Recorder {
  static isTypeSupported = (type: string) => type === 'video/mp4';
  state: RecordingState = 'inactive';
  mimeType = 'video/mp4';
  videoBitsPerSecond = 1_000_000;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, readonly options: MediaRecorderOptions) {}
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recorded-mp4'], { type: 'video/mp4' }) });
    this.onstop?.();
  }
}

const previousDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const getUserMedia = vi.fn();

beforeEach(() => {
  media.codec = 'avc';
  vi.stubGlobal('MediaRecorder', GenericMp4Recorder);
  getUserMedia.mockReset();
  const video = { kind: 'video', enabled: true, readyState: 'live', stop: vi.fn(),
    getSettings: () => ({ width: 480, height: 480, frameRate: 30 }) };
  const audio = { kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() };
  getUserMedia.mockResolvedValue({
    getTracks: () => [video, audio],
    getVideoTracks: () => [video],
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (previousDevices) Object.defineProperty(navigator, 'mediaDevices', previousDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('accepts an unqualified MP4 only after inspecting a real AVC video track', async () => {
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));
  await act(async () => { expect(await result.current.start()).toBe(true); });
  await act(async () => { expect(await result.current.stop()).toEqual(expect.objectContaining({ mimeType: 'video/mp4' })); });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('idle');
});

it('rejects a bare MP4 containing another video codec before entering the trim editor', async () => {
  media.codec = 'hevc';
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));
  await act(async () => { expect(await result.current.start()).toBe(true); });
  await act(async () => { expect(await result.current.stop()).toBeNull(); });
  expect(result.current.error).toContain('H.264');
  expect(onRecorded).not.toHaveBeenCalled();
});
