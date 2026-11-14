import { AVC_MP4_MIME_TYPES } from '../../shared/video-recording-diagnostic';

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

export function avcRecordingOptions(): MediaRecorderOptions | null {
  const supports = (mimeType: string): boolean => {
    try { return MediaRecorder.isTypeSupported?.(mimeType) === true; }
    catch { return false; } // Some embedded implementations throw for unknown codec parameters.
  };
  // Explicit H.264 profiles first; a generic MP4 requires post-recording codec inspection.
  const mimeType = AVC_MP4_MIME_TYPES.find(supports)
    ?? (supports('video/mp4') ? 'video/mp4' : null);
  return mimeType ? { mimeType, videoBitsPerSecond: 1_000_000 } : null;
}
