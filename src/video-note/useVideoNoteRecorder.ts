import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoNoteCameraSession, type VideoNoteFacingMode } from './useVideoNoteCameraSession';

import { avcRecordingOptions, VIDEO_RECORDING_PROFILES, type VideoRecordingProfile } from './video-recording-profile';

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
        release();
        setError('Не удалось завершить запись. Попробуйте ещё раз.');
        updateStatus('error');
      }
    });
  }, [release, clearTimers, updateStatus]);

  const start = useCallback(async (
    facing: VideoNoteFacingMode = 'user',
    permissionOnly = false,
    cameraOptions?: CameraOptions,
  ): Promise<boolean> => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'error') return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Этот Telegram WebView не поддерживает запись видео через камеру.');
      updateStatus('error');
      return false;
    }
    const options = avcRecordingOptions();
    if (!options) {
      setError(UNSUPPORTED_AVC);
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
        setError('Получение камеры было прервано. Включите её повторно.');
        updateStatus('error');
      }
      return false;
    }
    if (!mountedRef.current || epoch !== epochRef.current) {
      source.getTracks().forEach(track => { track.enabled = false; });
      return false;
    }
    setStream(source);
    if (permissionOnly) {
      source.getTracks().forEach(track => { track.enabled = profile !== 'circle' && track.kind === 'video'; });
      updateStatus('idle');
      return false;
    }
    if (cameraOptions?.profile) {
      const { video, profile: orientationProfile } = cameraOptions;
      if (!video || video.srcObject !== source || !video.videoWidth || !video.videoHeight || video.readyState < 2) {
        setError('Дождитесь изображения с камеры и повторите попытку.');
        updateStatus('error');
        return false;
      }
      const matchesOrientation = orientationProfile === 'portrait'
        ? video.videoHeight > video.videoWidth
        : video.videoWidth > video.videoHeight;
      if (!matchesOrientation) {
        const orientation = orientationProfile === 'portrait' ? 'вертикальный' : 'горизонтальный';
        setError(`Камера Telegram не отдаёт ${orientation} кадр. Можно выбрать готовое видео из галереи.`);
        updateStatus('error');
        return false;
      }
    }
    source.getTracks().forEach(track => { track.enabled = true; });
    recordingStreamRef.current = source;

    let recorder: MediaRecorder | null = null;
    try {
      recorder = new MediaRecorder(source, options);
      const settings = source.getVideoTracks()[0]?.getSettings?.() ?? {};
      const activeRecorder = recorder;
      const chunks: Blob[] = [];
      recorderRef.current = activeRecorder;
      startedAtRef.current = Date.now();
      stoppedAtRef.current = 0;
      activeRecorder.ondataavailable = event => {
        if (recorderRef.current === activeRecorder && event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onerror = () => {
        if (recorderRef.current !== activeRecorder) return;
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
        const validType = reportedTypes.length > 0 && reportedTypes.every(type =>
          /^video\/mp4(?:;|$)/i.test(type) && (!/codecs=/i.test(type) || /avc[13]/i.test(type)));
        const mimeType = 'video/mp4';
        const blob = new Blob(chunks, { type: mimeType });
        const durationMs = Math.min(maxDurationMs, Math.max(1, stoppedAtRef.current - startedAtRef.current));
        const interrupted = !stoppedAtRef.current;
        if (interrupted || !validType || blob.size === 0) {
          release();
          setError(interrupted ? 'Камера прервала запись. Попробуйте ещё раз.'
            : !validType ? 'Устройство не вернуло запись H.264 в MP4.'
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
      activeRecorder.start(1000);
      setElapsedMs(0);
      updateStatus('recording');
      const tick = () => setElapsedMs(Math.min(maxDurationMs, Math.max(0, Date.now() - startedAtRef.current)));
      tickRef.current = window.setInterval(tick, 250);
      deadlineRef.current = window.setTimeout(() => { void stop(); }, maxDurationMs);
      return true;
    } catch {
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
  }, [acquire, clearTimers, liveStream, maxDurationMs, profile, release, stop, updateStatus]);

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
  const error = unsupportedFormat ? 'Этот Telegram WebView не поддерживает запись H.264 в MP4.' : recordingError;
  return { start, stop, cancel, release, status, error, unsupportedFormat, dismissUnsupportedFormat, stream, elapsedMs,
    progress: Math.min(1, elapsedMs / maxDurationMs),
    hasStream: camera.hasStream };
}
