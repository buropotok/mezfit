// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoNoteRecorder } from './useVideoNoteRecorder';
import { reportVideoRecordingFailure } from './video-recording-diagnostics';

vi.mock('./video-recording-diagnostics', () => ({ reportVideoRecordingFailure: vi.fn() }));

const optionsSeen: MediaRecorderOptions[] = [];
const capabilities = { mp4: false };
class WebmRecorder {
  static isTypeSupported = (type: string) =>
    type === 'video/webm;codecs=vp8,opus' || (capabilities.mp4 && type === 'video/mp4;codecs=avc1,mp4a.40.2');
  state: RecordingState = 'inactive';
  mimeType: string;
  videoBitsPerSecond = 1_000_000;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_source: MediaStream, readonly options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? 'video/webm';
    optionsSeen.push(options);
  }
  start() {
    if (this.mimeType.startsWith('video/mp4')) throw new DOMException('Unsupported MP4', 'NotSupportedError');
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recorded'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
beforeEach(() => {
  localStorage.clear();
  optionsSeen.length = 0;
  capabilities.mp4 = false;
  vi.mocked(reportVideoRecordingFailure).mockClear();
  vi.stubGlobal('MediaRecorder', WebmRecorder);
  const track = { kind: 'video', enabled: true, readyState: 'live', stop: vi.fn(),
    getSettings: () => ({ width: 480, height: 480 }) };
  const audio = { kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true, value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track, audio], getVideoTracks: () => [track] })),
    },
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  if (mediaDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDescriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('records and publishes VP8/Opus WebM if MP4 is not advertised', async () => {
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));
  await act(async () => { expect(await result.current.start()).toBe(true); });
  await act(async () => {
    const clip = await result.current.stop();
    expect(clip?.mimeType).toBe('video/webm');
    expect(clip?.blob.type).toBe('video/webm');
  });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith('WEBM_AUTO_FALLBACK', 'circle', expect.anything());
});

it('tries WebM when an advertised MP4 recorder throws during start', async () => {
  capabilities.mp4 = true;
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));
  await act(async () => { expect(await result.current.start()).toBe(true); });
  expect(optionsSeen[0].mimeType).toBe('video/mp4;codecs=avc1,mp4a.40.2');
  expect(optionsSeen[1].mimeType).toBe('video/webm;codecs=vp8,opus');
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith(
    'RECORDER_MIME_ATTEMPT_FAILED', 'circle', expect.anything(),
  );
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith('WEBM_RUNTIME_FALLBACK', 'circle', expect.anything());
});
