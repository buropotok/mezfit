import { APP_ERROR_CODES } from './app-error-codes';

/** Public protocol for privacy-limited video and media diagnostics. */
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

export const MEDIA_DIAGNOSTIC_ERROR_CODES = [
  APP_ERROR_CODES.MEDIA_PHOTO_DECODE_FAILED,
  APP_ERROR_CODES.MEDIA_VIDEO_DECODE_FAILED,
  APP_ERROR_CODES.MEDIA_VIDEO_METADATA_INVALID,
  APP_ERROR_CODES.MEDIA_VIDEO_FRAME_INVALID,
  APP_ERROR_CODES.MEDIA_VIDEO_PREPARATION_FAILED,
  APP_ERROR_CODES.MEDIA_CHECK_TIMEOUT,
  APP_ERROR_CODES.MEDIA_REVIEW_PLAYBACK_FAILED,
  APP_ERROR_CODES.MEDIA_REVIEW_INSPECTION_FAILED,
  APP_ERROR_CODES.MEDIA_REVIEW_TRIM_FAILED,
  APP_ERROR_CODES.MEDIA_SEND_NETWORK_SIGNER,
  APP_ERROR_CODES.MEDIA_SEND_NETWORK_PUT,
  APP_ERROR_CODES.MEDIA_SEND_NETWORK_HEAD,
  APP_ERROR_CODES.MEDIA_SEND_NETWORK_OTHER,
  APP_ERROR_CODES.MEDIA_SEND_TIMEOUT,
  APP_ERROR_CODES.MEDIA_SEND_AUTH,
  APP_ERROR_CODES.MEDIA_SEND_SIGNER_UNAVAILABLE,
  APP_ERROR_CODES.MEDIA_SEND_STORAGE_HTTP,
  APP_ERROR_CODES.MEDIA_SEND_STORAGE_UNKNOWN,
  APP_ERROR_CODES.MEDIA_SEND_LOCAL_SAVE,
  APP_ERROR_CODES.MEDIA_SEND_MESSAGE,
  APP_ERROR_CODES.MEDIA_VOICE_UNSUPPORTED,
  APP_ERROR_CODES.MEDIA_VIDEO_NOTE_INVALID,
  APP_ERROR_CODES.VOICE_CAPTURE_UNAVAILABLE,
  APP_ERROR_CODES.VOICE_PERMISSION_DENIED,
  APP_ERROR_CODES.VOICE_CAPTURE_FAILED,
  APP_ERROR_CODES.VOICE_RECORD_FAILED,
  APP_ERROR_CODES.VOICE_RECORD_EMPTY,
  APP_ERROR_CODES.VOICE_RECORD_START_FAILED,
  APP_ERROR_CODES.VOICE_RECORD_STOP_FAILED,
] as const;

export const VIDEO_RECORDING_ERROR_CODES = [
  'UNSUPPORTED_MP4_AVC', 'MEDIA_API_UNAVAILABLE', 'CAMERA_ACCESS_FAILED',
  'CAMERA_INTERRUPTED', 'CAMERA_PREVIEW_NOT_READY', 'CAMERA_ORIENTATION',
  'CAMERA_ORIENTATION_FALLBACK',
  'RECORDER_START_FAILED', 'RECORDER_RUNTIME_FAILED', 'RECORDER_STOP_FAILED',
  'RECORDER_INTERRUPTED', 'RECORDING_EMPTY', 'RECORDED_FORMAT_INVALID',
  'RECORDER_MIME_ATTEMPT_FAILED',
  'WEBM_AUTO_FALLBACK', 'WEBM_RUNTIME_FALLBACK', 'WEBM_FORCED_MODE',
  'WEBM_EXACT_TRIM_FAILED', 'WEBM_KEYFRAME_FALLBACK', 'WEBM_TRIM_FAILED',
  'WEBM_TRIM_INSPECTION_FAILED',
  ...MEDIA_DIAGNOSTIC_ERROR_CODES,
] as const;

export const VIDEO_RECORDING_DEVICE_FIELDS = [
  'preferredFormat', 'selectedFormat', 'selectedCodec', 'videoCodec', 'audioCodec',
  'attemptedFormat', 'failingMimeType', 'trimFallbackCause', 'trimRequested', 'trimActual',
  'errorName', 'recorderMimeType', 'recordingSizeBytes', 'recordingDurationMs',
  'recorderVideoBitsPerSecond',
  'userAgent', 'platform', 'telegramPlatform', 'telegramVersion',
  'androidWebView', 'browserBrands', 'language', 'screen', 'viewport',
  'pixelRatio', 'colorDepth', 'touchPoints', 'deviceMemory', 'cpuThreads',
  'networkType', 'networkRtt', 'networkDownlink', 'secureContext',
  'mediaRecorder', 'isTypeSupported', 'getUserMedia', 'mediaDevices',
  'videoEncoder', 'mediaCapabilities', 'supportedConstraints',
  'mediaMimeType', 'mediaSizeBytes', 'mediaErrorCode', 'mediaReadyState',
  'mediaNetworkState', 'mediaUploadStage', 'mediaUploadStatus',
  'cameraWidth', 'cameraHeight', 'cameraFrameRate', 'cameraFacingMode',
  'cameraRequestedSize', 'cameraPreviewSize', 'cameraFallbackResult',
] as const;

export type VideoRecordingErrorCode = typeof VIDEO_RECORDING_ERROR_CODES[number];
export type VideoRecordingProfile = 'circle' | 'portrait' | 'landscape' | 'media' | 'voice';
export type VideoRecordingDiagnostic = {
  errorCode: VideoRecordingErrorCode;
  profile: VideoRecordingProfile;
  mimeSupport: Record<string, 'yes' | 'no' | 'unavailable'>;
  device: Partial<Record<typeof VIDEO_RECORDING_DEVICE_FIELDS[number], string>>;
};
