import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoNoteCameraSession, type VideoNoteFacingMode } from './useVideoNoteCameraSession';

import { recordingOptionsCandidates, VIDEO_RECORDING_PROFILES, type VideoRecordingProfile } from './video-recording-profile';
import { getVideoRecordingFormatPreference } from './video-recording-format-preference';
import { reportVideoRecordingFailure } from './video-recording-diagnostics';
import type { VideoRecordingDiagnostic, VideoRecordingErrorCode } from '../../shared/video-recording-diagnostic';

export interface VideoNoteRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  capture?: { settings: MediaTrackSettings; recorderMimeType: string; videoBitsPerSecond: number };
}

export type VideoNoteRecorderStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'error';
const UNSUPPORTED_AVC = Symbol('unsupported-avc');

type CameraOptions = { requireFacing?: boolean } & (
  { video: HTMLVideoElement | null; profile: Exclude<VideoRecordingProfile, 'circle'> }
  | { video?: never; profile?: never }
);
function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Нет доступа к камере или микрофону. Разрешите доступ в Telegram и повторите попытку.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Камера или микрофон не найдены на устройстве.';
    }
    if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
      return 'Выбранная камера недоступна на этом устройстве.';
    }
    if (error.name === 'NotReadableError' || error.name === 'AbortError') {
      return 'Камера занята другим приложением или временно недоступна.';
    }
  }
  return 'Не удалось запустить запись. Проверьте разрешения и поддержку камеры в Telegram.';
}

/**
 * Shared Settings/chat video-note capture engine. The camera session is owned by
 * useVideoNoteCameraSession; this hook owns MediaRecorder and recorded bytes.
 * No recording, permission request, upload or publication occurs on mount.
 */
export function useVideoNoteRecorder(onRecorded?: (clip: VideoNoteRecording) => void, profile: VideoRecordingProfile = 'circle', session = false) {
  const maxDurationMs = VIDEO_RECORDING_PROFILES[profile].maxDurationMs;
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const camera = useVideoNoteCameraSession(profile, session);
  const { acquire, liveStream, release: releaseCamera } = camera;
  const [status, setStatus] = useState<VideoNoteRecorderStatus>('idle');
  const [recordingError, setError] = useState<string | typeof UNSUPPORTED_AVC>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const statusRef = useRef<VideoNoteRecorderStatus>('idle');
  const mountedRef = useRef(false);
  const epochRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const resolveStopRef = useRef<((clip: VideoNoteRecording | null) => void) | null>(null);
  const startedAtRef = useRef(0);
  const stoppedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const cameraSettingsRef = useRef<MediaTrackSettings>({});
  const failedMimeTypesRef = useRef(new Set<string>());

  const reportFailure = useCallback((
    code: VideoRecordingErrorCode, extra: VideoRecordingDiagnostic['device'] = {},
  ) => {
    const settings = cameraSettingsRef.current;
    reportVideoRecordingFailure(code, profile, {
      cameraWidth: settings.width === undefined ? undefined : String(settings.width),
      cameraHeight: settings.height === undefined ? undefined : String(settings.height),
      cameraFrameRate: settings.frameRate === undefined ? undefined : String(settings.frameRate),
      cameraFacingMode: settings.facingMode,
      ...extra,
    });
  }, [profile]);

  const updateStatus = useCallback((next: VideoNoteRecorderStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);
  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
    tickRef.current = null;
    deadlineRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    epochRef.current += 1;
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* WebView already ended recording. */ }
      }
    }
    recordingStreamRef.current?.getTracks().forEach(track => { track.enabled = false; });
    recordingStreamRef.current = null;
    resolveStopRef.current?.(null);
    resolveStopRef.current = null;
    updateStatus('idle');
  }, [clearTimers, updateStatus]);

  const release = useCallback(() => {
    cancel();
    releaseCamera();
    if (mountedRef.current) { setStream(null); setError(''); }
  }, [cancel, releaseCamera]);

  const stop = useCallback((): Promise<VideoNoteRecording | null> => {
    const recorder = recorderRef.current;
    if (statusRef.current !== 'recording' || !recorder || recorder.state !== 'recording') {
      return Promise.resolve(null);
    }
    clearTimers();
    stoppedAtRef.current = Date.now();
    updateStatus('processing');
    return new Promise(resolve => {
      resolveStopRef.current = resolve;
      try { recorder.stop(); }
      catch {
        resolveStopRef.current = null;
        resolve(null);
        reportFailure('RECORDER_STOP_FAILED');
        release();
        setError('Не удалось завершить запись. Попробуйте ещё раз.');
        updateStatus('error');
      }
    });
  }, [release, clearTimers, reportFailure, updateStatus]);

  const start = useCallback(async (
    facing: VideoNoteFacingMode = 'user',
    permissionOnly = false,
    cameraOptions?: CameraOptions,
  ): Promise<boolean> => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'error') return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      reportFailure('MEDIA_API_UNAVAILABLE');
      setError('Этот Telegram WebView не поддерживает запись видео через камеру.');
      updateStatus('error');
      return false;
    }
    const preference = getVideoRecordingFormatPreference();
    const candidates = recordingOptionsCandidates(preference)
      .filter(option => !failedMimeTypesRef.current.has(option.mimeType ?? ''));
    if (!candidates.length) {
      reportFailure('UNSUPPORTED_MP4_AVC', { preferredFormat: preference });
      setError(preference === 'webm'
        ? 'Этот Telegram WebView не поддерживает выбранную запись VP8/VP9 в WebM.'
        : UNSUPPORTED_AVC);
      updateStatus('error');
      return false;
    }
    const epoch = ++epochRef.current;
    setError('');
    updateStatus('requesting');
    let source = liveStream(facing, cameraOptions?.requireFacing);
    if (!source) {
      setStream(null);
      try { source = await acquire(facing, cameraOptions?.requireFacing); }
      catch (cause) {
        if (mountedRef.current && epoch === epochRef.current) {
          reportFailure('CAMERA_ACCESS_FAILED', { errorName: cause instanceof DOMException ? cause.name : 'unknown' });
          setError(cameraError(cause));
          updateStatus('error');
        }
        return false;
      }
    }
    // The first permission prompt can outlive the original pointer gesture.
    // Keep an acquired live session, but never record for a released gesture.
    if (!source) {
      if (mountedRef.current && epoch === epochRef.current) {
        reportFailure('CAMERA_INTERRUPTED');
        setError('Получение камеры было прервано. Включите её повторно.');
        updateStatus('error');
      }
      return false;
    }
    if (!mountedRef.current || epoch !== epochRef.current) {
      source.getTracks().forEach(track => { track.enabled = false; });
      return false;
    }
    cameraSettingsRef.current = source.getVideoTracks()[0]?.getSettings?.() ?? {};
    setStream(source);
    if (permissionOnly) {
      source.getTracks().forEach(track => { track.enabled = profile !== 'circle' && track.kind === 'video'; });
      updateStatus('idle');
      return false;
    }
    if (cameraOptions?.profile) {
      const { video, profile: orientationProfile } = cameraOptions;
      if (!video || video.srcObject !== source || !video.videoWidth || !video.videoHeight || video.readyState < 2) {
        reportFailure('CAMERA_PREVIEW_NOT_READY');
        setError('Дождитесь изображения с камеры и повторите попытку.');
        updateStatus('error');
        return false;
      }
      const matchesOrientation = orientationProfile === 'portrait'
        ? video.videoHeight > video.videoWidth
        : video.videoWidth > video.videoHeight;
      if (!matchesOrientation) {
        const orientation = orientationProfile === 'portrait' ? 'вертикальный' : 'горизонтальный';
        reportFailure('CAMERA_ORIENTATION');
        setError(`Камера Telegram не отдаёт ${orientation} кадр. Можно выбрать готовое видео из галереи.`);
        updateStatus('error');
        return false;
      }
    }
    source.getTracks().forEach(track => { track.enabled = true; });
    recordingStreamRef.current = source;

    let recorder: MediaRecorder | null = null;
    try {
      let chosen: MediaRecorderOptions | null = null;
      let lastStartErrorName = 'unknown';
      const startupFailures: string[] = [];
      let failedMp4 = [...failedMimeTypesRef.current].some(type => type.startsWith('video/mp4'));
      for (const attempt of candidates) {
        let candidateRecorder: MediaRecorder | null = null;
        try {
          candidateRecorder = new MediaRecorder(source, attempt);
          candidateRecorder.start(1000);
          recorder = candidateRecorder;
          chosen = attempt;
          break;
        } catch (cause) {
          lastStartErrorName = cause instanceof DOMException ? cause.name : 'unknown';
          if (attempt.mimeType?.startsWith('video/mp4')) failedMp4 = true;
          failedMimeTypesRef.current.add(attempt.mimeType ?? '');
          startupFailures.push((attempt.mimeType ?? 'unknown') + ': ' + lastStartErrorName);
          if (candidateRecorder?.state !== 'inactive' && candidateRecorder) {
            try { candidateRecorder.stop(); } catch { /* Unusable candidate. */ }
          }
        }
      }
      if (!recorder || !chosen) {
        reportFailure('RECORDER_START_FAILED', {
          preferredFormat: preference, errorName: lastStartErrorName,
          attemptedFormat: candidates.map(item => item.mimeType).join(', '),
        });
        release();
        setError('Ни один доступный формат видеозаписи не удалось запустить.');
        updateStatus('error');
        return false;
      }
      const options = chosen;
      if (startupFailures.length) reportFailure('RECORDER_MIME_ATTEMPT_FAILED', {
        attemptedFormat: startupFailures.join('; '),
        selectedFormat: options.mimeType,
        preferredFormat: preference,
      });
      const activeRecorder = recorder;
      const settings = source.getVideoTracks()[0]?.getSettings?.() ?? {};
      const chunks: Blob[] = [];
      recorderRef.current = activeRecorder;
      startedAtRef.current = Date.now();
      stoppedAtRef.current = 0;
      if (options.mimeType?.startsWith('video/webm')) {
        reportFailure(preference === 'webm' ? 'WEBM_FORCED_MODE'
          : failedMp4 ? 'WEBM_RUNTIME_FALLBACK' : 'WEBM_AUTO_FALLBACK', {
          preferredFormat: preference, selectedFormat: options.mimeType,
          attemptedFormat: failedMp4 ? 'mp4-start-failed' : 'mp4-not-supported',
        });
      }
      activeRecorder.ondataavailable = event => {
        if (recorderRef.current === activeRecorder && event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onerror = () => {
        if (recorderRef.current !== activeRecorder) return;
        failedMimeTypesRef.current.add(options.mimeType ?? '');
        reportFailure('RECORDER_RUNTIME_FAILED', { recorderMimeType: activeRecorder.mimeType,
          selectedFormat: options.mimeType });
        release();
        setError('Произошла ошибка видеозаписи. Попробуйте ещё раз.');
        updateStatus('error');
      };
      activeRecorder.onstop = () => {
        if (recorderRef.current !== activeRecorder || epoch !== epochRef.current) return;
        recorderRef.current = null;
        clearTimers();
        recordingStreamRef.current?.getTracks().forEach(track => { track.enabled = false; });
        recordingStreamRef.current = null;
        const recorderMimeType = activeRecorder.mimeType || chunks[0]?.type || '';
        const reportedTypes = [activeRecorder.mimeType, chunks[0]?.type].filter(Boolean);
        const isWebm = options.mimeType?.startsWith('video/webm') ?? false;
        const validReportedType = reportedTypes.length > 0 && reportedTypes.every(type => isWebm
          ? /^video\/webm(?:;|$)/i.test(type) && (!/codecs=/i.test(type) || /vp[89]/i.test(type))
          : /^video\/mp4(?:;|$)/i.test(type) && (!/codecs=/i.test(type) || /avc[13]/i.test(type)));
        const mimeType = isWebm ? 'video/webm' : 'video/mp4';
        const blob = new Blob(chunks, { type: mimeType });
        const durationMs = Math.min(maxDurationMs, Math.max(1, stoppedAtRef.current - startedAtRef.current));
        const interrupted = !stoppedAtRef.current;

        const finish = async () => {
          let validType = validReportedType;
          // A generic container MIME cannot guarantee an editor-compatible codec.
          if (validType && !interrupted && blob.size > 0 &&
            (options.mimeType === 'video/mp4' || isWebm)) {
            try {
              const { Input, MP4, WebM, BlobSource } = await import('mediabunny');
              if (epoch !== epochRef.current) return;
              const input = new Input({ formats: [isWebm ? WebM : MP4], source: new BlobSource(blob) });
              try {
                const track = await input.getPrimaryVideoTrack();
                const codec = await track?.getCodec();
                validType = isWebm ? codec === 'vp8' || codec === 'vp9' : codec === 'avc';
              } finally {
                input.dispose();
              }
            } catch {
              validType = false;
            }
          }
          if (!mountedRef.current || epoch !== epochRef.current) return;
          if (interrupted || !validType || blob.size === 0) {
            reportFailure(interrupted ? 'RECORDER_INTERRUPTED'
              : blob.size === 0 ? 'RECORDING_EMPTY' : 'RECORDED_FORMAT_INVALID', {
              recorderMimeType, selectedFormat: options.mimeType,
              recordingSizeBytes: String(blob.size),
              recordingDurationMs: String(durationMs),
              recorderVideoBitsPerSecond: String(activeRecorder.videoBitsPerSecond),
            });
            release();
            setError(interrupted ? 'Камера прервала запись. Попробуйте ещё раз.'
              : !validType ? 'Устройство вернуло несовместимый формат видеозаписи.'
              : 'Запись оказалась пустой. Попробуйте ещё раз.');
            updateStatus('error');
          } else {
            const clip = { blob, mimeType, durationMs,
              capture: { settings, recorderMimeType, videoBitsPerSecond: activeRecorder.videoBitsPerSecond } };
            updateStatus('idle');
            resolveStopRef.current?.(clip);
            onRecordedRef.current?.(clip);
          }
          resolveStopRef.current = null;
        };
        void finish();
      };
      setElapsedMs(0);
      updateStatus('recording');
      const tick = () => setElapsedMs(Math.min(maxDurationMs, Math.max(0, Date.now() - startedAtRef.current)));
      tickRef.current = window.setInterval(tick, 250);
      deadlineRef.current = window.setTimeout(() => { void stop(); }, maxDurationMs);
      return true;
    } catch (cause) {
      reportFailure('RECORDER_START_FAILED', { errorName: cause instanceof DOMException ? cause.name : 'unknown' });
      recorderRef.current = null;
      recordingStreamRef.current?.getTracks().forEach(track => { track.enabled = false; });
      recordingStreamRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* Startup already failed. */ }
      }
      release();
      setError('Формат записи не поддерживается этим устройством.');
      updateStatus('error');
      return false;
    }
  }, [acquire, clearTimers, liveStream, maxDurationMs, profile, release, reportFailure, stop, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    const onHidden = () => { if (document.visibilityState === 'hidden') release(); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', release);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [release]);

  const dismissUnsupportedFormat = useCallback(() => {
    setError(current => current === UNSUPPORTED_AVC ? '' : current);
  }, []);

  const unsupportedFormat = recordingError === UNSUPPORTED_AVC;
  const error = unsupportedFormat
    ? 'Этот Telegram WebView не поддерживает запись H.264 в MP4 или VP8/VP9 в WebM.'
    : recordingError;
  return { start, stop, cancel, release, status, error, unsupportedFormat, dismissUnsupportedFormat, stream, elapsedMs,
    progress: Math.min(1, elapsedMs / maxDurationMs),
    hasStream: camera.hasStream };
}
