import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text } from '../ui';
import { CircularVideoPlayback } from './CircularVideoPlayback';
import { VideoNoteRecordingRing } from './VideoNoteRing';
import { useVideoNoteCameraSession, type VideoNoteFacingMode } from '../video-note/useVideoNoteCameraSession';
import './video-note-module.css';

const MAX_RECORDING_MS = 60_000;
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm',
];

type CaptureStage = 'idle' | 'requesting' | 'ready' | 'recording' | 'processing' | 'review' | 'error';

interface RecordedNote {
  url: string;
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
}

function recordingOptions(): MediaRecorderOptions | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
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

/** Standalone, device-only camera probe. It never uploads or persists user media. */
export function VideoNoteModule() {
  const [stage, setStage] = useState<CaptureStage>('idle');
  const [facing, setFacing] = useState<VideoNoteFacingMode>('user');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [clip, setClip] = useState<RecordedNote | null>(null);
  const [error, setError] = useState('');

  const mounted = useRef(false);
  const requestSequence = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const { acquire, liveStream, release } = useVideoNoteCameraSession();

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    if (deadlineRef.current !== null) window.clearTimeout(deadlineRef.current);
    tickRef.current = null;
    deadlineRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    if (previewRef.current) previewRef.current.srcObject = null;
    release();
  }, [release]);

  const discardClip = useCallback(() => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    if (mounted.current) setClip(null);
  }, []);

  const cancelCapture = useCallback(() => {
    requestSequence.current += 1;
    clearTick();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* Already stopped by WebView. */ }
      }
    }
    stopStream();
    discardClip();
    setElapsedSeconds(0);
    setRecordingProgress(0);
  }, [clearTick, discardClip, stopStream]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelCapture();
    };
  }, [cancelCapture]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    let disposed = false;
    if (stage === 'ready' || stage === 'recording' || stage === 'processing') {
      preview.srcObject = liveStream(facing);
      void preview.play().catch(() => {
        if (!disposed && mounted.current) setError('Автовоспроизведение камеры заблокировано. Проверьте настройки Telegram.');
      });
    } else {
      preview.srcObject = null;
    }
    return () => { disposed = true; };
  }, [stage, facing, liveStream]);

  const openCamera = async (nextFacing: VideoNoteFacingMode) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Этот Telegram WebView не поддерживает запись видео через камеру.');
      setStage('error');
      return;
    }
    const sequence = ++requestSequence.current;
    discardClip();
    setFacing(nextFacing);
    setError('');

    // A retake reuses the active camera+microphone stream and never requests permission again.
    if (liveStream(nextFacing)) {
      setStage('ready');
      return;
    }

    setStage('requesting');
    try {
      const stream = await acquire(nextFacing);
      if (!stream || !mounted.current || sequence !== requestSequence.current) return;
      setStage('ready');
    } catch (cause) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setError(cameraError(cause));
      setStage('error');
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    clearTick();
    const duration = Date.now() - startedAtRef.current;
    setElapsedSeconds(Math.min(60, Math.ceil(duration / 1000)));
    setRecordingProgress(Math.min(1, duration / MAX_RECORDING_MS));
    setStage('processing');
    try {
      recorder.stop();
    } catch {
      recorderRef.current = null;
      stopStream();
      setError('Не удалось завершить запись. Попробуйте ещё раз.');
      setStage('error');
    }
  };

  const startRecording = () => {
    if (recorderRef.current) return;
    const stream = liveStream(facing);
    if (!stream) {
      setError('Камера отключилась. Включите её повторно.');
      setStage('error');
      return;
    }
    try {
      const options = recordingOptions();
      const recorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (recorderRef.current !== recorder) return;
        recorderRef.current = null;
        recorder.onstop = null;
        clearTick();
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* Recorder failed before stopping. */ }
        }
        stopStream();
        setError('Произошла ошибка видеозаписи. Попробуйте ещё раз.');
        setStage('error');
      };
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return;
        recorderRef.current = null;
        clearTick();
        // Keep live media tracks for retakes; release only on reset, camera switch or unmount.
        if (!mounted.current) return;
        const mimeType = recorder.mimeType || chunks[0]?.type || 'video/webm';
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size === 0) {
          setError('Запись оказалась пустой. Попробуйте ещё раз.');
          setStage('error');
          return;
        }
        let url: string;
        try {
          url = URL.createObjectURL(blob);
        } catch {
          setError('Не удалось подготовить видео для просмотра.');
          setStage('error');
          return;
        }
        clipUrlRef.current = url;
        setClip({
          url,
          mimeType,
          sizeBytes: blob.size,
          durationSeconds: Math.min(60, Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000))),
        });
        setStage('review');
      };
      recorder.start(1000);
      setElapsedSeconds(0);
      setRecordingProgress(0);
      setError('');
      setStage('recording');
      tickRef.current = window.setInterval(() => {
        const duration = Date.now() - startedAtRef.current;
        setElapsedSeconds(Math.min(60, Math.ceil(duration / 1000)));
        setRecordingProgress(Math.min(1, duration / MAX_RECORDING_MS));
        if (duration >= MAX_RECORDING_MS && recorderRef.current === recorder) stopRecording();
      }, 250);
      deadlineRef.current = window.setTimeout(() => {
        if (recorderRef.current === recorder) stopRecording();
      }, MAX_RECORDING_MS);
    } catch {
      recorderRef.current = null;
      clearTick();
      setError('Формат записи не поддерживается этим устройством.');
      setStage('ready');
    }
  };

  const reset = () => {
    cancelCapture();
    setError('');
    setStage('idle');
  };

  const cameraVisible = stage === 'ready' || stage === 'recording' || stage === 'processing';

  return (
    <section className="video-note-module">
      <div
        className={`video-note-module__circle${cameraVisible || stage === 'review' ? ' video-note-module__circle--expanded' : ''}`}
        aria-label="Круглый видеопредпросмотр"
      >
        <video
          ref={previewRef}
          className="video-note-module__video"
          autoPlay
          muted
          playsInline
          style={{ display: cameraVisible ? 'block' : 'none' }}
          aria-label="Изображение с камеры"
        />
        {stage === 'review' && clip ? (
          <CircularVideoPlayback
            key={clip.url}
            src={clip.url}
            fallbackDuration={clip.durationSeconds}
            onError={setError}
          />
        ) : null}
        {!cameraVisible && stage !== 'review' ? (
          <Text variant="footnote" tone="muted" className="video-note-module__placeholder">
            {stage === 'requesting' ? 'Подключаем камеру…' : 'Предпросмотр камеры'}
          </Text>
        ) : null}
        {(stage === 'recording' || stage === 'processing') ? (
          <VideoNoteRecordingRing progress={recordingProgress} />
        ) : null}
        {stage === 'recording' ? <div className="video-note-module__recording-dot" aria-label="Идёт запись" /> : null}
      </div>

      <Text variant="footnote" tone="muted" role="status">
        {stage === 'recording' || stage === 'processing'
          ? `Запись: ${elapsedSeconds} / 60 сек.`
          : stage === 'review' && clip
            ? `Готово: ${clip.durationSeconds} сек., ${(clip.sizeBytes / 1024 / 1024).toFixed(1)} МБ · ${clip.mimeType}`
            : stage === 'ready'
              ? 'Камера готова. Видео записывается со звуком.'
              : 'Тестовый модуль: видео остаётся только на этом устройстве и не отправляется в чат.'}
      </Text>

      {stage === 'review' && liveStream(facing) ? (
        <Text variant="footnote" tone="muted">
          Камера и микрофон остаются активны для повторной записи. «Сбросить» отключит их.
        </Text>
      ) : null}

      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}

      <div className="video-note-module__actions">
        {(stage === 'idle' || stage === 'error') ? (
          <Button onClick={() => void openCamera(facing)}>Включить камеру</Button>
        ) : null}
        {stage === 'ready' ? (
          <>
            <Button onClick={startRecording}>Начать запись</Button>
            <Button variant="secondary" onClick={() => void openCamera(facing === 'user' ? 'environment' : 'user')}>
              Сменить камеру
            </Button>
          </>
        ) : null}
        {stage === 'recording' ? <Button onClick={stopRecording}>Завершить запись</Button> : null}
        {stage === 'review' && clip ? (
          <Button variant="secondary" onClick={() => void openCamera(facing)}>Записать заново</Button>
        ) : null}
        {stage !== 'idle' && stage !== 'error' && stage !== 'requesting' ? (
          <Button variant="secondary" onClick={reset}>Сбросить</Button>
        ) : null}
      </div>
    </section>
  );
}
