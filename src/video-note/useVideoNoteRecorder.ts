import { useCallback, useEffect, useRef, useState } from 'react';
import { useVideoNoteCameraSession, type VideoNoteFacingMode } from './useVideoNoteCameraSession';

export interface VideoNoteRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export type VideoNoteRecorderStatus = 'idle' | 'requesting' | 'recording' | 'processing' | 'error';
const MAX_RECORDING_MS = 60_000;
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm',
];

function recordingOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  const mimeType = MIME_CANDIDATES.find(candidate => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Нет доступа к камере или микрофону. Разрешите доступ в Telegram и повторите попытку.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Камера или микрофон не найдены на устройстве.';
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
export function useVideoNoteRecorder(onRecorded?: (clip: VideoNoteRecording) => void) {
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const camera = useVideoNoteCameraSession();
  const { acquire, liveStream, release: releaseCamera } = camera;
  const [status, setStatus] = useState<VideoNoteRecorderStatus>('idle');
  const [error, setError] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const statusRef = useRef<VideoNoteRecorderStatus>('idle');
  const mountedRef = useRef(false);
  const epochRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const resolveStopRef = useRef<((clip: VideoNoteRecording | null) => void) | null>(null);
  const startedAtRef = useRef(0);
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
    resolveStopRef.current?.(null);
    resolveStopRef.current = null;
    updateStatus('idle');
  }, [clearTimers, updateStatus]);

  const release = useCallback(() => {
    cancel();
    releaseCamera();
    if (mountedRef.current) setStream(null);
  }, [cancel, releaseCamera]);

  const stop = useCallback((): Promise<VideoNoteRecording | null> => {
    const recorder = recorderRef.current;
    if (statusRef.current !== 'recording' || !recorder || recorder.state !== 'recording') {
      return Promise.resolve(null);
    }
    clearTimers();
    updateStatus('processing');
    return new Promise(resolve => {
      resolveStopRef.current = resolve;
      try { recorder.stop(); }
      catch {
        resolveStopRef.current = null;
        resolve(null);
        cancel();
        setError('Не удалось завершить запись. Попробуйте ещё раз.');
        updateStatus('error');
      }
    });
  }, [cancel, clearTimers, updateStatus]);

  const start = useCallback(async (facing: VideoNoteFacingMode = 'user', permissionOnly = false): Promise<boolean> => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'error') return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Этот Telegram WebView не поддерживает запись видео через камеру.');
      updateStatus('error');
      return false;
    }
    const epoch = ++epochRef.current;
    setError('');
    updateStatus('requesting');
    let source = liveStream(facing);
    if (!source) {
      try { source = await acquire(facing); }
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
    if (!mountedRef.current || epoch !== epochRef.current || !source) return false;
    setStream(source);
    if (permissionOnly) { updateStatus('idle'); return false; }

    let recorder: MediaRecorder | null = null;
    try {
      const options = recordingOptions();
      recorder = options ? new MediaRecorder(source, options) : new MediaRecorder(source);
      const activeRecorder = recorder;
      const chunks: Blob[] = [];
      recorderRef.current = activeRecorder;
      startedAtRef.current = Date.now();
      activeRecorder.ondataavailable = event => {
        if (recorderRef.current === activeRecorder && event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onerror = () => {
        if (recorderRef.current !== activeRecorder) return;
        cancel();
        setError('Произошла ошибка видеозаписи. Попробуйте ещё раз.');
        updateStatus('error');
      };
      activeRecorder.onstop = () => {
        if (recorderRef.current !== activeRecorder || epoch !== epochRef.current) return;
        recorderRef.current = null;
        clearTimers();
        const mimeType = activeRecorder.mimeType || chunks[0]?.type || options?.mimeType || 'video/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const durationMs = Math.min(MAX_RECORDING_MS, Math.max(1, Date.now() - startedAtRef.current));
        if (blob.size === 0) {
          setError('Запись оказалась пустой. Попробуйте ещё раз.');
          updateStatus('error');
          resolveStopRef.current?.(null);
        } else {
          const clip = { blob, mimeType, durationMs };
          updateStatus('idle');
          resolveStopRef.current?.(clip);
          onRecordedRef.current?.(clip);
        }
        resolveStopRef.current = null;
      };
      activeRecorder.start(1000);
      setElapsedMs(0);
      updateStatus('recording');
      const tick = () => setElapsedMs(Math.min(MAX_RECORDING_MS, Math.max(0, Date.now() - startedAtRef.current)));
      tickRef.current = window.setInterval(tick, 250);
      // A held button cannot make a Telegram video note longer than one minute.
      deadlineRef.current = window.setTimeout(() => { void stop(); }, MAX_RECORDING_MS);
      return true;
    } catch {
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* Startup already failed. */ }
      }
      clearTimers();
      setError('Формат записи не поддерживается этим устройством.');
      updateStatus('error');
      return false;
    }
  }, [acquire, clearTimers, liveStream, stop, updateStatus]);

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

  return { start, stop, cancel, release, status, error, stream, elapsedMs,
    progress: Math.min(1, elapsedMs / MAX_RECORDING_MS),
    hasStream: (facing: VideoNoteFacingMode) => liveStream(facing) !== null };
}
