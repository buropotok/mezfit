// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoNoteRecorder } from './useVideoNoteRecorder';
import { videoRecordingConstraints } from './video-recording-profile';
import { reportVideoRecordingFailure } from './video-recording-diagnostics';
import { waitForCameraFrame } from './camera-orientation';

vi.mock('./video-recording-diagnostics', () => ({ reportVideoRecordingFailure: vi.fn() }));

const mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
const getUserMedia = vi.fn();
const previousDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

class Recorder {
  static isTypeSupported = (type: string) => type === mimeType;
  static starts = 0;
  state: RecordingState = 'inactive';
  start() { this.state = 'recording'; Recorder.starts += 1; }
  stop() { this.state = 'inactive'; }
}

beforeEach(() => {
  Recorder.starts = 0;
  getUserMedia.mockReset();
  vi.mocked(reportVideoRecordingFailure).mockClear();
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (previousDevices) Object.defineProperty(navigator, 'mediaDevices', previousDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

async function camera(width: number, height: number) {
  const dimensions = { width, height };
  const applyConstraints = vi.fn(async (_constraints: MediaTrackConstraints) => {
    dimensions.width = 720;
    dimensions.height = 1280;
  });
  const track = { kind: 'video', readyState: 'live', stop: vi.fn(), applyConstraints,
    getSettings: () => ({ ...dimensions, frameRate: 30, facingMode: 'environment' }) };
  const source = { getVideoTracks: () => [track], getTracks: () => [track] };
  getUserMedia.mockResolvedValue(source);
  const hook = renderHook(() => useVideoNoteRecorder(undefined, 'portrait'));
  await act(async () => { await hook.result.current.start('environment', true); });
  const video = document.createElement('video');
  Object.defineProperties(video, {
    srcObject: { value: source },
    videoWidth: { get: () => dimensions.width },
    videoHeight: { get: () => dimensions.height },
    readyState: { value: 2 },
  });
  const start = () => hook.result.current.start('environment', false, { video, profile: 'portrait' });
  return { ...hook, video, start, track, applyConstraints };
}

it('requests sensor dimensions on iPhone while preserving the circle profile', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7)');
  expect(videoRecordingConstraints('portrait')).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 } });
  expect(videoRecordingConstraints('circle')).toMatchObject({ width: { ideal: 480 }, height: { ideal: 488 } });
});

it('preserves the Android request and starts a working portrait camera without a fallback', async () => {
  const capture = await camera(720, 1280);
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
    video: expect.objectContaining({ width: { ideal: 720 }, height: { ideal: 1280 } }),
  }));
  await act(async () => { expect(await capture.start()).toBe(true); });
  expect(capture.applyConstraints).not.toHaveBeenCalled();
  expect(Recorder.starts).toBe(1);
});

it('retries the Android sensor dimensions and starts only after the camera becomes portrait', async () => {
  const capture = await camera(1280, 720);
  await act(async () => { expect(await capture.start()).toBe(true); });
  expect(capture.applyConstraints).toHaveBeenCalledExactlyOnceWith({
    width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
  });
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(Recorder.starts).toBe(1);
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith('CAMERA_ORIENTATION_FALLBACK', 'portrait',
    expect.objectContaining({ cameraFallbackResult: 'success', cameraPreviewSize: '720x1280' }));
});

it('keeps recording blocked when the fallback still returns a landscape frame', async () => {
  vi.useFakeTimers();
  const capture = await camera(1280, 720);
  capture.applyConstraints.mockImplementation(async () => {});
  await act(async () => {
    const started = capture.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await started).toBe(false);
  });
  expect(Recorder.starts).toBe(0);
  expect(capture.applyConstraints).toHaveBeenCalledOnce();
  expect(capture.result.current.error).toContain('не отдаёт вертикальный кадр');
});

it('reports a rejected fallback without starting MediaRecorder', async () => {
  const capture = await camera(1280, 720);
  capture.applyConstraints.mockRejectedValue(new DOMException('Unavailable', 'OverconstrainedError'));
  await act(async () => { expect(await capture.start()).toBe(false); });
  expect(Recorder.starts).toBe(0);
  expect(reportVideoRecordingFailure).toHaveBeenCalledWith('CAMERA_ORIENTATION_FALLBACK', 'portrait',
    expect.objectContaining({ cameraFallbackResult: 'constraints-failed', errorName: 'OverconstrainedError' }));
});

it('does not start from a fallback that finishes after unmount', async () => {
  const capture = await camera(1280, 720);
  let complete = () => {};
  capture.applyConstraints.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  let started: Promise<boolean> = Promise.resolve(true);
  await act(async () => { started = capture.start(); });
  expect(capture.applyConstraints).toHaveBeenCalledOnce();
  capture.unmount();
  await act(async () => { complete(); expect(await started).toBe(false); });
  expect(Recorder.starts).toBe(0);
  expect(capture.track.stop).toHaveBeenCalledOnce();
});

it('waits for a decoded frame and cancels a pending frame callback on abort', async () => {
  vi.useFakeTimers();
  const video = document.createElement('video');
  const requestFrame = vi.fn(() => 1);
  const cancelFrame = vi.fn();
  Object.defineProperties(video, {
    requestVideoFrameCallback: { value: requestFrame },
    cancelVideoFrameCallback: { value: cancelFrame },
  });
  const controller = new AbortController();
  const ready = waitForCameraFrame(video, controller.signal);
  expect(requestFrame).toHaveBeenCalledOnce();
  controller.abort();
  expect(await ready).toBe(false);
  expect(cancelFrame).toHaveBeenCalledWith(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('checks orientation after the first decoded frame instead of using the initial dimensions', async () => {
  const capture = await camera(1280, 720);
  let onFrame: VideoFrameRequestCallback | undefined;
  Object.defineProperties(capture.video, {
    requestVideoFrameCallback: { value: (callback: VideoFrameRequestCallback) => { onFrame = callback; return 1; } },
    cancelVideoFrameCallback: { value: vi.fn() },
  });
  let started: Promise<boolean> = Promise.resolve(false);
  await act(async () => { started = capture.start(); });
  expect(Recorder.starts).toBe(0);
  // iOS corrects the initial sensor dimensions when its first frame is presented.
  await capture.applyConstraints({});
  capture.applyConstraints.mockClear();
  await act(async () => {
    onFrame?.(0, { width: 720, height: 1280, mediaTime: 0, presentedFrames: 1,
      expectedDisplayTime: 0, presentationTime: 0, processingDuration: 0 });
    expect(await started).toBe(true);
  });
  expect(capture.applyConstraints).not.toHaveBeenCalled();
  expect(Recorder.starts).toBe(1);
});

it('waits for the rear stream to replace an earlier preview before recording', async () => {
  const track = { kind: 'video', enabled: false, readyState: 'live', muted: false, stop: vi.fn() };
  const rear = { getTracks: () => [track], getVideoTracks: () => [track] };
  getUserMedia.mockResolvedValue(rear);
  const { result } = renderHook(() => useVideoNoteRecorder(undefined, 'portrait'));
  const video = document.createElement('video');
  const previous = {};
  Object.defineProperties(video, {
    srcObject: { value: previous, writable: true },
    readyState: { value: 2 }, videoWidth: { value: 720 }, videoHeight: { value: 1280 },
  });
  const started = { current: Promise.resolve(false) };
  await act(async () => {
    started.current = result.current.start('environment', false, { video, profile: 'portrait' });
  });
  expect(Recorder.starts).toBe(0);
  expect(track.enabled).toBe(true);
  await act(async () => {
    Object.defineProperty(video, 'srcObject', { value: rear });
    video.dispatchEvent(new Event('loadeddata'));
    expect(await started.current).toBe(true);
  });
  expect(Recorder.starts).toBe(1);
});

it('discards a stalled rear stream so the existing camera button can reopen it', async () => {
  vi.useFakeTimers();
  const track = { kind: 'video', enabled: false, readyState: 'live', muted: true, stop: vi.fn() };
  const rear = { getTracks: () => [track], getVideoTracks: () => [track] };
  const replacementTrack = { ...track, muted: false, stop: vi.fn() };
  const replacement = { getTracks: () => [replacementTrack], getVideoTracks: () => [replacementTrack] };
  getUserMedia.mockResolvedValueOnce(rear).mockResolvedValueOnce(replacement);
  const { result } = renderHook(() => useVideoNoteRecorder(undefined, 'portrait', true));
  const video = document.createElement('video');
  Object.defineProperty(video, 'srcObject', { value: rear });
  await act(async () => {
    const started = result.current.start('environment', false, { video, profile: 'portrait' });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await started).toBe(false);
  });
  expect(Recorder.starts).toBe(0);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(result.current.error).toContain('CAMERA_PREVIEW_NOT_READY');
  await act(async () => { await result.current.start('environment', true); });
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  expect(result.current.stream).toBe(replacement);
});
