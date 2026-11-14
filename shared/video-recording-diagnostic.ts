/** Public protocol for privacy-limited, opt-in-by-deployment video recording diagnostics. */
export const AVC_MP4_MIME_TYPES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=avc1.42001F,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.4D401F',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc3.42E01E',
  'video/mp4;codecs=avc1.424028,mp4a.40.2',
] as const;

export const VIDEO_RECORDING_MIME_TYPES = [
  ...AVC_MP4_MIME_TYPES,
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const;

export const VIDEO_RECORDING_ERROR_CODES = [
  'UNSUPPORTED_MP4_AVC', 'MEDIA_API_UNAVAILABLE', 'CAMERA_ACCESS_FAILED',
  'CAMERA_INTERRUPTED', 'CAMERA_PREVIEW_NOT_READY', 'CAMERA_ORIENTATION',
  'RECORDER_START_FAILED', 'RECORDER_RUNTIME_FAILED', 'RECORDER_STOP_FAILED',
  'RECORDER_INTERRUPTED', 'RECORDING_EMPTY', 'RECORDED_FORMAT_INVALID',
  'WEBM_AUTO_FALLBACK', 'WEBM_RUNTIME_FALLBACK', 'WEBM_FORCED_MODE',
  'WEBM_EXACT_TRIM_FAILED', 'WEBM_KEYFRAME_FALLBACK', 'WEBM_TRIM_FAILED',
  'WEBM_TRIM_INSPECTION_FAILED',
] as const;

export const VIDEO_RECORDING_DEVICE_FIELDS = [
  'userAgent', 'platform', 'telegramPlatform', 'telegramVersion',
  'androidWebView', 'browserBrands', 'language', 'screen', 'viewport',
  'pixelRatio', 'colorDepth', 'touchPoints', 'deviceMemory', 'cpuThreads',
  'networkType', 'networkRtt', 'networkDownlink', 'secureContext',
  'mediaRecorder', 'isTypeSupported', 'getUserMedia', 'mediaDevices',
  'videoEncoder', 'mediaCapabilities', 'supportedConstraints',
  'cameraWidth', 'cameraHeight', 'cameraFrameRate', 'cameraFacingMode',
  'errorName', 'recorderMimeType', 'recordingSizeBytes', 'recordingDurationMs',
  'recorderVideoBitsPerSecond',
  'preferredFormat', 'selectedFormat', 'selectedCodec', 'videoCodec',
  'audioCodec', 'trimFallbackCause', 'trimRequested', 'trimActual',
  'attemptedFormat', 'failingMimeType',
] as const;

export type VideoRecordingErrorCode = typeof VIDEO_RECORDING_ERROR_CODES[number];
export type VideoRecordingProfile = 'circle' | 'portrait' | 'landscape';
export type VideoRecordingDiagnostic = {
  errorCode: VideoRecordingErrorCode;
  profile: VideoRecordingProfile;
  mimeSupport: Record<string, 'yes' | 'no' | 'unavailable'>;
  device: Partial<Record<typeof VIDEO_RECORDING_DEVICE_FIELDS[number], string>>;
};
