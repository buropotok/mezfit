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

const AVC_MP4_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.42001F,mp4a.40.2',
  'video/mp4;codecs=avc1',
];

export function avcRecordingOptions(): MediaRecorderOptions | null {
  const mimeType = AVC_MP4_TYPES.find(type => MediaRecorder.isTypeSupported?.(type));
  return mimeType ? { mimeType, videoBitsPerSecond: 1_000_000 } : null;
}
