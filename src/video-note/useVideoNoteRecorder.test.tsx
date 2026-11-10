// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVideoNoteRecorder } from './useVideoNoteRecorder';

class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'video/mp4;codecs=avc1,mp4a.40.2';
  state: RecordingState = 'inactive';
  mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly stream: MediaStream) {}
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['video'], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

const getUserMedia = vi.fn();
const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
function fakeStream() {
  let readyState: MediaStreamTrackState = 'live';
  const stop = vi.fn(() => { readyState = 'ended'; });
  const track = { stop, get readyState() { return readyState; } };
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia.mockReset();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (descriptor) Object.defineProperty(navigator, 'mediaDevices', descriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('requests camera and microphone only once per mounted session and reuses the stream', async () => {
  const capture = fakeStream();
  getUserMedia.mockResolvedValue(capture.stream);
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));

  await act(async () => { expect(await result.current.start('user', true)).toBe(false); });
  expect(result.current.hasStream('user')).toBe(true);
  expect(result.current.status).toBe('idle');
  expect(onRecorded).not.toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
    video: { facingMode: { ideal: 'user' }, width: { ideal: 480 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: expect.any(Object),
  }));

  await act(async () => { expect(await result.current.start('user')).toBe(true); });
  expect(result.current.status).toBe('recording');
  await act(async () => {
    const clip = await result.current.stop();
    expect(clip).toEqual(expect.objectContaining({ mimeType: 'video/mp4' }));
    expect(clip?.blob.size).toBeGreaterThan(0);
  });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('idle');
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(capture.stop).not.toHaveBeenCalled();

  act(() => result.current.release());
  expect(capture.stop).toHaveBeenCalledOnce();
});

it('a permission prompt finishing after pointer cancellation cannot start a recording', async () => {
  const capture = fakeStream();
  let allow: ((value: MediaStream) => void) | undefined;
  getUserMedia.mockImplementation(() => new Promise<MediaStream>(resolve => { allow = resolve; }));
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));
  let first!: Promise<boolean>;
  act(() => { first = result.current.start('user', true); });
  expect(result.current.status).toBe('requesting');
  act(() => result.current.cancel());
  await act(async () => { allow?.(capture.stream); expect(await first).toBe(false); });
  expect(result.current.status).toBe('idle');
  expect(result.current.hasStream('user')).toBe(true);
  expect(onRecorded).not.toHaveBeenCalled();

  await act(async () => { expect(await result.current.start('user')).toBe(true); });
  expect(getUserMedia).toHaveBeenCalledOnce();
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(capture.stop).toHaveBeenCalledOnce();
  expect(onRecorded).not.toHaveBeenCalled();
});

it('automatically stops and publishes exactly one video note at 60 seconds', async () => {
  const capture = fakeStream();
  getUserMedia.mockResolvedValue(capture.stream);
  const onRecorded = vi.fn();
  const { result } = renderHook(() => useVideoNoteRecorder(onRecorded));
  await act(async () => { await result.current.start('user'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(onRecorded).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('idle');
  await act(async () => { expect(await result.current.stop()).toBeNull(); });
  expect(onRecorded).toHaveBeenCalledOnce();
});
