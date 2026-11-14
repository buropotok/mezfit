import { afterEach, expect, it, vi } from 'vitest';
import { avcRecordingOptions } from './video-recording-profile';

afterEach(() => vi.unstubAllGlobals());

it('keeps the preferred AVC+AAC MIME when advertised by the WebView', () => {
  const isTypeSupported = vi.fn((type: string) => type === 'video/mp4;codecs=avc1,mp4a.40.2');
  vi.stubGlobal('MediaRecorder', { isTypeSupported });
  expect(avcRecordingOptions()).toEqual({
    mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', videoBitsPerSecond: 1_000_000,
  });
  expect(isTypeSupported).not.toHaveBeenCalledWith('video/mp4');
});

it('tries other H.264 profiles and versions before a generic MP4', () => {
  const isTypeSupported = vi.fn((type: string) => type === 'video/mp4;codecs=avc1.4D401F');
  vi.stubGlobal('MediaRecorder', { isTypeSupported });
  expect(avcRecordingOptions()?.mimeType).toBe('video/mp4;codecs=avc1.4D401F');
  expect(isTypeSupported).not.toHaveBeenCalledWith('video/mp4');
});

it('uses bare MP4 only when every explicit H.264 profile is unsupported', () => {
  const isTypeSupported = vi.fn((type: string) => type === 'video/mp4');
  vi.stubGlobal('MediaRecorder', { isTypeSupported });
  expect(avcRecordingOptions()).toEqual({ mimeType: 'video/mp4', videoBitsPerSecond: 1_000_000 });
});

it('rejects environments with only WebM recording support', () => {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => type.startsWith('video/webm') });
  expect(avcRecordingOptions()).toBeNull();
});

it('does not mistake an unavailable capability method for supported H.264', () => {
  vi.stubGlobal('MediaRecorder', {});
  expect(avcRecordingOptions()).toBeNull();
});
