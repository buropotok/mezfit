// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { recordingOptionsCandidates } from './video-recording-profile';
import {
  getVideoRecordingFormatPreference, setVideoRecordingFormatPreference,
} from './video-recording-format-preference';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('prefers MP4/H.264 before WebM on a capable device', () => {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) =>
    type === 'video/mp4;codecs=avc1' || type === 'video/webm;codecs=vp8,opus' });
  expect(recordingOptionsCandidates('mp4').map(item => item.mimeType)).toEqual([
    'video/mp4;codecs=avc1', 'video/webm;codecs=vp8,opus',
  ]);
});

it('automatically selects VP8/Opus on a WebM-only Telegram WebView', () => {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) =>
    type === 'video/webm;codecs=vp8,opus' || type === 'video/webm' });
  expect(recordingOptionsCandidates('mp4').map(item => item.mimeType)).toEqual([
    'video/webm;codecs=vp8,opus', 'video/webm',
  ]);
});

it('forced WebM never accidentally tests MP4 even when MP4 is supported', () => {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
  expect(recordingOptionsCandidates('webm')).toEqual([
    { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 1_000_000 },
    { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 1_000_000 },
    { mimeType: 'video/webm', videoBitsPerSecond: 1_000_000 },
  ]);
});

it('keeps the testing choice only on the current device and restores MP4 by default', () => {
  expect(getVideoRecordingFormatPreference()).toBe('mp4');
  expect(setVideoRecordingFormatPreference('webm')).toBe(true);
  expect(getVideoRecordingFormatPreference()).toBe('webm');
  expect(setVideoRecordingFormatPreference('mp4')).toBe(true);
  expect(getVideoRecordingFormatPreference()).toBe('mp4');
  expect(localStorage.getItem('mezfit.video-recording-format-v1')).toBeNull();
});
