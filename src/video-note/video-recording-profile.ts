import { AVC_MP4_MIME_TYPES } from '../../shared/video-recording-diagnostic';
import type { VideoRecordingFormatPreference } from './video-recording-format-preference';

export const VIDEO_RECORDING_PROFILES = {
  circle: { width: 480, height: 480, maxDurationMs: 60_000 },
  landscape: { width: 1280, height: 720, maxDurationMs: 180_000 },
  portrait: { width: 720, height: 1280, maxDurationMs: 180_000 },
} as const;

export type VideoRecordingProfile = keyof typeof VIDEO_RECORDING_PROFILES;

export function videoRecordingConstraints(profile: VideoRecordingProfile): MediaTrackConstraints {
  const { width, height } = VIDEO_RECORDING_PROFILES[profile];
  const supported = navigator.mediaDevices?.getSupportedConstraints?.();
  const canRequireNativeSize = profile !== 'circle' && supported && 'resizeMode' in supported && supported.resizeMode === true;
  return {
    width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 },
    ...(canRequireNativeSize ? { resizeMode: { exact: 'none' } } : {}),
  };
}

const WEBM_RECORDING_TYPES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const;

function supported(mimeType: string): boolean {
  try { return MediaRecorder.isTypeSupported?.(mimeType) === true; }
  catch { return false; } // Some embedded WebViews throw for unfamiliar MIME parameters.
}

/** Keep the legacy MP4 contract intact for the existing AVC editor and tests. */
export function avcRecordingOptions(): MediaRecorderOptions | null {
  const mimeType = AVC_MP4_MIME_TYPES.find(supported)
    ?? (supported('video/mp4') ? 'video/mp4' : null);
  return mimeType ? { mimeType, videoBitsPerSecond: 1_000_000 } : null;
}

/** Ordered attempts include constructor/start failures, not only MIME capability responses. */
export function recordingOptionsCandidates(preference: VideoRecordingFormatPreference): MediaRecorderOptions[] {
  const mp4 = [...AVC_MP4_MIME_TYPES, 'video/mp4'].filter(supported);
  const webm = WEBM_RECORDING_TYPES.filter(supported);
  return (preference === 'webm' ? webm : [...mp4, ...webm])
    .map(mimeType => ({ mimeType, videoBitsPerSecond: 1_000_000 }));
}
