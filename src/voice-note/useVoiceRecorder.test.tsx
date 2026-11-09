// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceRecorder, type VoiceRecording } from './useVoiceRecorder';

class FakeAudioRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state: RecordingState = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    const event = new Event('dataavailable');
    Object.defineProperty(event, 'data', { value: new Blob(['voice bytes'], { type: 'audio/webm' }) });
    this.ondataavailable?.(event as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

const getUserMedia = vi.fn();
const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function fakeAudioStream() {
  const track = { readyState: 'live' as MediaStreamTrackState, stop: vi.fn() };
  track.stop.mockImplementation(() => { track.readyState = 'ended'; });
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream,
  };
}

beforeEach(() => {
  getUserMedia.mockReset();
  vi.stubGlobal('MediaRecorder', FakeAudioRecorder);
  vi.stubGlobal('AudioContext', undefined); // No live analysis in jsdom.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('useVoiceRecorder', () => {
  it('records audio-only with one permission request across multiple takes', async () => {
    const media = fakeAudioStream();
    getUserMedia.mockResolvedValue(media.stream);
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => expect(await result.current.start()).toBe(true));
    expect(result.current.status).toBe('recording');
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });

    let first: VoiceRecording | null = null;
    await act(async () => { first = await result.current.stop(); });
    expect(first).not.toBeNull();
    expect((first as unknown as VoiceRecording).blob.size).toBeGreaterThan(0);
    expect((first as unknown as VoiceRecording).mimeType).toBe('audio/webm');
    expect(result.current.status).toBe('idle');
    expect(media.track.stop).not.toHaveBeenCalled();

    await act(async () => expect(await result.current.start()).toBe(true));
    await act(async () => expect(await result.current.stop()).not.toBeNull());
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(media.track.stop).not.toHaveBeenCalled();

    unmount();
    expect(media.track.stop).toHaveBeenCalledOnce();
  });

  it('stores measured waveform peaks from the real-time microphone analyser', async () => {
    const media = fakeAudioStream();
    getUserMedia.mockResolvedValue(media.stream);
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      createMediaStreamSource() { return { connect: () => undefined }; }
      createAnalyser() {
        return {
          fftSize: 512,
          getByteTimeDomainData: (values: Uint8Array) => {
            values.fill(128);
            values[0] = 214; // Nonzero measured PCM deviation.
          },
        };
      }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    });
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    await act(async () => expect(await result.current.start()).toBe(true));
    act(() => vi.advanceTimersByTime(430));
    let clip: VoiceRecording | null = null;
    await act(async () => { clip = await result.current.stop(); });
    expect((clip as unknown as VoiceRecording).waveform).toHaveLength(42);
    expect((clip as unknown as VoiceRecording).waveform.every((bar) => bar > 0)).toBe(true);

    unmount();
    expect(media.track.stop).toHaveBeenCalledOnce();
  });

  it('cancel preserves permission while explicit release closes the mic', async () => {
    const media = fakeAudioStream();
    getUserMedia.mockResolvedValue(media.stream);
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    await act(async () => { await result.current.start(); });
    act(() => result.current.cancel());
    expect(result.current.status).toBe('idle');
    expect(media.track.stop).not.toHaveBeenCalled();

    await act(async () => { await result.current.start(); });
    expect(getUserMedia).toHaveBeenCalledOnce();
    act(() => result.current.release());
    expect(media.track.stop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('idle');
    unmount();
    expect(media.track.stop).toHaveBeenCalledOnce();
  });

  it('releases late getUserMedia after unmount instead of retaining a hidden mic', async () => {
    let resolveMedia: ((stream: MediaStream) => void) | undefined;
    getUserMedia.mockImplementation(() => new Promise<MediaStream>((resolve) => {
      resolveMedia = resolve;
    }));
    const media = fakeAudioStream();
    const { result, unmount } = renderHook(() => useVoiceRecorder());
    const pending = result.current.start();
    expect(await result.current.start()).toBe(false); // No duplicate permission prompts.
    expect(getUserMedia).toHaveBeenCalledOnce();
    unmount();
    await act(async () => {
      resolveMedia?.(media.stream);
      expect(await pending).toBe(false);
    });
    expect(media.track.stop).toHaveBeenCalledOnce();
  });

  it('handles permission denial and permits another user-triggered attempt', async () => {
    const media = fakeAudioStream();
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(media.stream);
    const { result, unmount } = renderHook(() => useVoiceRecorder());

    await act(async () => expect(await result.current.start()).toBe(false));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/микрофон/);

    await act(async () => expect(await result.current.start()).toBe(true));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    unmount();
    expect(media.track.stop).toHaveBeenCalledOnce();
  });

  it('releases the mic when Telegram WebView closes even if React stays mounted', async () => {
    const media = fakeAudioStream();
    getUserMedia.mockResolvedValue(media.stream);
    const { result, unmount } = renderHook(() => useVoiceRecorder());
    await act(async () => { await result.current.start(); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(media.track.stop).toHaveBeenCalledOnce();
    unmount();
    expect(media.track.stop).toHaveBeenCalledOnce();
  });
});
