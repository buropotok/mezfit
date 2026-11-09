// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoNoteCameraSession } from './useVideoNoteCameraSession';

const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
const getUserMedia = vi.fn();

function stream() {
  let state: MediaStreamTrackState = 'live';
  const stop = vi.fn(() => { state = 'ended'; });
  const track = { stop, get readyState() { return state; } } as unknown as MediaStreamTrack;
  return {
    source: { getTracks: () => [track] } as unknown as MediaStream,
    stop,
    end: () => { state = 'ended'; },
  };
}

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (previousMediaDevices) Object.defineProperty(navigator, 'mediaDevices', previousMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('useVideoNoteCameraSession', () => {
  it('reuses one permission request for several takes and frees it on reset', async () => {
    const capture = stream();
    getUserMedia.mockResolvedValue(capture.source);
    const { result, unmount } = renderHook(() => useVideoNoteCameraSession());

    await act(async () => {
      expect(await result.current.acquire('user')).toBe(capture.source);
      expect(await result.current.acquire('user')).toBe(capture.source);
    });
    expect(result.current.liveStream('user')).toBe(capture.source);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(capture.stop).not.toHaveBeenCalled();

    act(() => result.current.release());
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(result.current.liveStream('user')).toBeNull();
    unmount();
    expect(capture.stop).toHaveBeenCalledOnce();
  });

  it('reacquires after the old stream ends and releases the replacement on pagehide', async () => {
    const first = stream();
    const second = stream();
    getUserMedia.mockResolvedValueOnce(first.source).mockResolvedValueOnce(second.source);
    const { result, unmount } = renderHook(() => useVideoNoteCameraSession());

    await act(async () => {
      expect(await result.current.acquire('user')).toBe(first.source);
    });
    first.end();
    expect(result.current.liveStream('user')).toBeNull();

    await act(async () => {
      expect(await result.current.acquire('user')).toBe(second.source);
    });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(second.stop).toHaveBeenCalledOnce();
    expect(result.current.liveStream('user')).toBeNull();
    unmount();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it('discards an in-flight permission result after unmount instead of leaking the camera', async () => {
    let resolvePermission: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => {
      resolvePermission = resolve;
    }));
    const capture = stream();
    const { result, unmount } = renderHook(() => useVideoNoteCameraSession());
    const pending = result.current.acquire('user');

    unmount();
    await act(async () => {
      resolvePermission?.(capture.source);
      expect(await pending).toBeNull();
    });
    expect(capture.stop).toHaveBeenCalledOnce();
  });
});
