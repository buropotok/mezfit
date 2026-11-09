import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text } from '../ui';
import './video-note-module.css';

const MAX_RECORDING_MS = 60_000;
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm',
];

type CaptureStage = 'idle' | 'requesting' | 'ready' | 'recording' | 'processing' | 'review' | 'error';
type FacingMode = 'user' | 'environment';

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
  const [facing, setFacing] = useState<FacingMode>('user');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [clip, setClip] = useState<RecordedNote | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);

  const mounted = useRef(false);
  const requestSequence = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef<HTMLVideoElement | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);

  const clearTick = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    if (previewRef.current) previewRef.current.srcObject = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const discardClip = useCallback(() => {
    playbackRef.current?.pause();
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    setClip(null);
    setPlaying(false);
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
    if (stage === 'ready' || stage === 'recording' || stage === 'processing') {
      preview.srcObject = streamRef.current;
      void preview.play().catch(() => {
        if (mounted.current) setError('Автовоспроизведение камеры заблокировано. Проверьте настройки Telegram.');
      });
    } else {
      preview.srcObject = null;
    }
  }, [stage]);

  const openCamera = async (nextFacing: FacingMode) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Этот Telegram WebView не поддерживает запись видео через камеру.');
      setStage('error');
      return;
    }
    const sequence = ++requestSequence.current;
    stopStream();
    discardClip();
    setFacing(nextFacing);
    setError('');
    setStage('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mounted.current || sequence !== requestSequence.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
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
    setElapsedSeconds(Math.min(60, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
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
    const stream = streamRef.current;
    if (!stream || recorderRef.current) return;
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
        clearTick();
        stopStream();
        setError('Произошла ошибка видеозаписи. Попробуйте ещё раз.');
        setStage('error');
      };
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return;
        recorderRef.current = null;
        clearTick();
        stopStream();
        if (!mounted.current) return;
        const mimeType = recorder.mimeType || chunks[0]?.type || 'video/webm';
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size === 0) {
          setError('Запись оказалась пустой. Попробуйте ещё раз.');
          setStage('error');
          return;
        }
        const url = URL.createObjectURL(blob);
        clipUrlRef.current = url;
        setClip({
          url,
          mimeType,
          sizeBytes: blob.size,
          durationSeconds: Math.min(60, Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000))),
        });
        setPlaying(false);
        setStage('review');
      };
      recorder.start(1000);
      setElapsedSeconds(0);
      setError('');
      setStage('recording');
      tickRef.current = window.setInterval(() => {
        const duration = Date.now() - startedAtRef.current;
        setElapsedSeconds(Math.min(60, Math.ceil(duration / 1000)));
        if (duration >= MAX_RECORDING_MS && recorderRef.current === recorder) stopRecording();
      }, 250);
    } catch {
      recorderRef.current = null;
      clearTick();
      setError('Формат записи не поддерживается этим устройством.');
      setStage('ready');
    }
  };

  const togglePlayback = async () => {
    const video = playbackRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      setPlaying(false);
      return;
    }
    try {
      await video.play();
      if (mounted.current) setPlaying(true);
    } catch {
      if (mounted.current) {
        setPlaying(false);
        setError('Устройство не смогло воспроизвести этот видеоформат.');
      }
    }
  };

  const reset = () => {
    cancelCapture();
    setError('');
    setStage('idle');
  };

  const cameraVisible = stage === 'ready' || stage === 'recording' || stage === 'processing';

  return (
    <section className="video-note-module" aria-label="Видеокружок">
      <div className="video-note-module__circle" aria-label="Круглый видеопредпросмотр">
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
          <video
            ref={playbackRef}
            key={clip.url}
            className="video-note-module__video"
            src={clip.url}
            playsInline
            preload="metadata"
            onEnded={() => setPlaying(false)}
            aria-label="Записанный видеокружок"
          />
        ) : null}
        {!cameraVisible && stage !== 'review' ? (
          <Text variant="footnote" tone="muted" className="video-note-module__placeholder">
            {stage === 'requesting' ? 'Подключаем камеру…' : 'Предпросмотр камеры'}
          </Text>
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
          <>
            <Button onClick={() => void togglePlayback()}>{playing ? 'Пауза' : 'Воспроизвести'}</Button>
            <Button variant="secondary" onClick={() => void openCamera(facing)}>Записать заново</Button>
          </>
        ) : null}
        {stage !== 'idle' && stage !== 'error' && stage !== 'requesting' ? (
          <Button variant="secondary" onClick={reset}>Сбросить</Button>
        ) : null}
      </div>
    </section>
  );
}
