// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoNoteRecorder } from './useVideoNoteRecorder';

const mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
const getUserMedia = vi.fn();
const previousDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

class Recorder {
  static isTypeSupported = vi.fn((type: string) => type === mimeType);
  static latest: Recorder;
  mimeType = mimeType;
  videoBitsPerSecond = 960_000;
  state: RecordingState = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, readonly options: MediaRecorderOptions) {
    Recorder.latest = this;
  }

  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['video'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const settings = { width: 640, height: 480, frameRate: 24 };
function camera() {
  const video = { kind: 'video', readyState: 'live', stop: vi.fn(), getSettings: () => settings };
  const audio = { kind: 'audio', readyState: 'live', stop: vi.fn() };
  getUserMedia.mockResolvedValue({ getTracks: () => [video, audio], getVideoTracks: () => [video] });
  return { video, audio };
}

beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia.mockReset();
  Recorder.isTypeSupported.mockClear();
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (previousDevices) Object.defineProperty(navigator, 'mediaDevices', previousDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it.each([
  ['circle', 480, 480, 60_000],
  ['landscape', 1280, 720, 180_000],
  ['portrait', 720, 1280, 180_000],
] as const)('requests the %s profile and reports actual capture settings', async (profile, width, height, durationMs) => {
  camera();
  const recorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(recorded, profile));
  await act(async () => { await result.current.start(); });

  expect(getUserMedia).toHaveBeenCalledWith({
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 }, facingMode: { ideal: 'user' } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  expect(Recorder.latest.options).toEqual({ mimeType, videoBitsPerSecond: 1_000_000 });
  await act(async () => { await vi.advanceTimersByTimeAsync(durationMs - 1); });
  expect(recorded).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(recorded).toHaveBeenCalledOnce();
  expect(recorded).toHaveBeenCalledWith(expect.objectContaining({
    mimeType: 'video/mp4', durationMs, capture: { settings, recorderMimeType: mimeType, videoBitsPerSecond: 960_000 },
  }));
});

it('explains missing AVC support before requesting camera access', async () => {
  Recorder.isTypeSupported.mockReturnValue(false);
  try {
    const { result } = renderHook(() => useVideoNoteRecorder());
    await act(async () => { await result.current.start(); });
    expect(result.current.error).toContain('H.264');
    expect(getUserMedia).not.toHaveBeenCalled();
  } finally {
    Recorder.isTypeSupported.mockImplementation(type => type === mimeType);
  }
});

it('reports denied camera access', async () => {
  getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  const { result } = renderHook(() => useVideoNoteRecorder());
  await act(async () => { await result.current.start(); });
  expect(result.current.error).toContain('Нет доступа');
});

it.each(['error', 'pagehide', 'hidden', 'unmount'] as const)(
  'releases both tracks and discards the partial take after %s', async event => {
    const { video, audio } = camera();
    const recorded = vi.fn();
    const { result, unmount } = renderHook(() => useVideoNoteRecorder(recorded, 'portrait'));
    await act(async () => { await result.current.start(); });
    const visibility = event === 'hidden' ? vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden') : null;
    try {
      act(() => {
        if (event === 'error') Recorder.latest.onerror?.();
        else if (event === 'pagehide') window.dispatchEvent(new Event('pagehide'));
        else if (event === 'hidden') document.dispatchEvent(new Event('visibilitychange'));
        else unmount();
      });
      expect(video.stop).toHaveBeenCalledOnce();
      expect(audio.stop).toHaveBeenCalledOnce();
      expect(recorded).not.toHaveBeenCalled();
      if (event === 'error') expect(result.current.error).toContain('ошибка видеозаписи');
    } finally {
      visibility?.mockRestore();
    }
  },
);

it.each([
  { width: 720, height: 1280, starts: true },
  { width: 1280, height: 720, starts: false },
  { width: 720, height: 720, starts: false },
])('only starts portrait recording with a portrait camera frame ($width × $height)', async ({ width, height, starts }) => {
  camera();
  const { result } = renderHook(() => useVideoNoteRecorder(undefined, 'portrait'));
  await act(async () => { await result.current.start('environment', true); });
  const source = result.current.stream;
  expect(source).not.toBeNull();
  const video = document.createElement('video');
  Object.defineProperties(video, {
    srcObject: { value: source },
    videoWidth: { value: width },
    videoHeight: { value: height },
    readyState: { value: 2 },
  });
  const previousRecorder = Recorder.latest;
  await act(async () => {
    expect(await result.current.start('environment', false, { video, profile: 'portrait' })).toBe(starts);
  });
  if (starts) {
    expect(Recorder.latest).not.toBe(previousRecorder);
    expect(result.current.status).toBe('recording');
  } else {
    expect(Recorder.latest).toBe(previousRecorder);
    expect(result.current.error).toContain('не отдаёт вертикальный кадр');
  }
});
