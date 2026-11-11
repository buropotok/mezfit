// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acquireSessionMicrophone, hasSessionMicrophone } from '../voice-note/sessionMicrophone';
import { useVideoNoteCameraSession } from './useVideoNoteCameraSession';

class Track {
  readyState: MediaStreamTrackState = 'live';
  enabled = true;
  constructor(readonly kind: string) {}
  stop = vi.fn(() => { this.readyState = 'ended'; });
  clone() { return new Track(this.kind); }
}
class Stream {
  constructor(private readonly tracks: Track[]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  clone() { return new Stream(this.tracks.map(track => track.clone())); }
}
const getUserMedia = vi.fn();
const descriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

beforeEach(() => {
  getUserMedia.mockReset();
  vi.stubGlobal('MediaStream', Stream);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
});
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllGlobals();
  if (descriptor) Object.defineProperty(navigator, 'mediaDevices', descriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('retains access across discussion unmounts and shares the microphone with voice recording', async () => {
  const source = new Stream([new Track('video'), new Track('audio')]);
  getUserMedia.mockResolvedValue(source);
  const first = renderHook(() => useVideoNoteCameraSession('circle', true));
  await act(async () => { await first.result.current.acquire('user'); });
  first.unmount();
  expect(source.getTracks().every(track => !track.enabled)).toBe(true);
  expect(source.getTracks().every(track => track.readyState === 'live')).toBe(true);

  const second = renderHook(() => useVideoNoteCameraSession('circle', true));
  expect(second.result.current.hasStream('user')).toBe(true);
  expect(second.result.current.hasStream('environment')).toBe(false);
  expect(second.result.current.hasStream('environment', true)).toBe(true);
  await act(async () => { await second.result.current.acquire('user'); });
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(hasSessionMicrophone()).toBe(true);
  const voice = await acquireSessionMicrophone({ audio: true, video: false });
  expect(voice.getVideoTracks()).toHaveLength(0);
  expect(voice.getAudioTracks().every(track => track.enabled)).toBe(true);
  voice.getTracks().forEach(track => track.stop());
  expect(hasSessionMicrophone()).toBe(true);
  expect(getUserMedia).toHaveBeenCalledOnce();

  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(second.result.current.hasStream('user')).toBe(false);
  expect(hasSessionMicrophone()).toBe(false);
  source.getTracks().forEach(track => expect(track.stop).toHaveBeenCalledOnce());
});

it('a late grant belongs to the next discussion and cannot start the closed recorder', async () => {
  const source = new Stream([new Track('video'), new Track('audio')]);
  let resolve: ((stream: Stream) => void) | undefined;
  getUserMedia.mockImplementation(() => new Promise<Stream>(grant => { resolve = grant; }));
  const first = renderHook(() => useVideoNoteCameraSession('circle', true));
  let oldRequest!: Promise<MediaStream | null>;
  act(() => { oldRequest = first.result.current.acquire('user'); });
  first.unmount();
  const second = renderHook(() => useVideoNoteCameraSession('circle', true));
  let newRequest!: Promise<MediaStream | null>;
  act(() => { newRequest = second.result.current.acquire('user'); });
  await act(async () => {
    resolve?.(source);
    expect(await oldRequest).toBeNull();
    expect(await newRequest).toBe(source);
  });
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(second.result.current.liveStream('user')).toBe(source);
});

it('rejects a permission result that arrives after the WebView session ended', async () => {
  const source = new Stream([new Track('video'), new Track('audio')]);
  let resolve: ((stream: Stream) => void) | undefined;
  getUserMedia.mockImplementation(() => new Promise<Stream>(grant => { resolve = grant; }));
  const hook = renderHook(() => useVideoNoteCameraSession('circle', true));
  let request!: Promise<MediaStream | null>;
  act(() => { request = hook.result.current.acquire('user'); });
  const rejected = expect(request).rejects.toThrow('Camera session closed');
  act(() => window.dispatchEvent(new Event('pagehide')));
  await act(async () => { resolve?.(source); await rejected; });
  source.getTracks().forEach(track => expect(track.stop).toHaveBeenCalledOnce());
});

it('can retry a denied camera request', async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
  const hook = renderHook(() => useVideoNoteCameraSession('circle', true));
  await act(async () => { await expect(hook.result.current.acquire('user')).rejects.toThrow('Denied'); });
  expect(hook.result.current.hasStream('user')).toBe(false);
  getUserMedia.mockResolvedValue(new Stream([new Track('video')]));
  await act(async () => { expect(await hook.result.current.acquire('user')).toBeTruthy(); });
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});
