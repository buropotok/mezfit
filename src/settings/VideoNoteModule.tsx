import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text } from '../ui';
import { CircularVideoPlayback } from './CircularVideoPlayback';
import { VideoNoteRecordingRing } from './VideoNoteRing';
import { useVideoNoteRecorder, type VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { type VideoNoteFacingMode } from '../video-note/useVideoNoteCameraSession';
import { shouldShowWebViewUpdate, VideoWebViewUpdatePopover } from '../video-note/VideoWebViewUpdatePopover';
import './video-note-module.css';

type PreviewStage = 'idle' | 'preview' | 'play' | 'error';

interface RecordedNote {
  url: string;
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
  capture: VideoNoteRecording['capture'];
}

/** The Settings gallery is a probe. Chat reuses the same recording engine and player. */
export function VideoNoteModule() {
  const [stage, setStage] = useState<PreviewStage>('idle');
  const [facing, setFacing] = useState<VideoNoteFacingMode>('user');
  const [clip, setClip] = useState<RecordedNote | null>(null);
  const [previewError, setPreviewError] = useState('');
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const clipUrlRef = useRef<string | null>(null);

  const discardClip = useCallback(() => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    setClip(null);
  }, []);

  const handleRecorded = useCallback((recording: VideoNoteRecording) => {
    try {
      const url = URL.createObjectURL(recording.blob);
      clipUrlRef.current = url;
      setClip({ url, mimeType: recording.mimeType, sizeBytes: recording.blob.size, capture: recording.capture,
        durationSeconds: Math.min(60, Math.max(1, Math.ceil(recording.durationMs / 1000))) });
      setStage('preview');
    } catch {
      setPreviewError('Не удалось подготовить видео для просмотра.');
      setStage('error');
    }
  }, []);

  const recorder = useVideoNoteRecorder(handleRecorded);
  const viewStage = recorder.status === 'idle' ? stage : recorder.status;
  const showWebViewUpdate = shouldShowWebViewUpdate(recorder.unsupportedFormat);
  const error = (showWebViewUpdate ? '' : recorder.error) || previewError;

  useEffect(() => () => {
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
  }, []);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    let disposed = false;
    if (viewStage === 'recording' || viewStage === 'processing') {
      preview.srcObject = recorder.stream;
      if (recorder.stream) void preview.play().catch(() => {
        if (!disposed) setPreviewError('Автовоспроизведение камеры заблокировано. Проверьте настройки Telegram.');
      });
    } else preview.srcObject = null;
    return () => { disposed = true; };
  }, [viewStage, recorder.stream]);

  const beginRecording = (nextFacing: VideoNoteFacingMode) => {
    discardClip();
    setFacing(nextFacing);
    setPreviewError('');
    setStage('idle');
    void recorder.start(nextFacing);
  };

  const stopRecording = () => { void recorder.stop(); };

  const reset = () => {
    recorder.release();
    discardClip();
    setPreviewError('');
    setStage('idle');
  };

  const cameraVisible = viewStage === 'recording' || viewStage === 'processing';
  const hasClip = (viewStage === 'preview' || viewStage === 'play') && clip !== null;

  return (
    <section className="video-note-module">
      <div
        className={`video-note-module__circle${cameraVisible || viewStage === 'play' ? ' video-note-module__circle--expanded' : viewStage === 'preview' ? ' video-note-module__circle--preview' : ''}`}
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
        {hasClip ? (
          <CircularVideoPlayback
            key={clip.url}
            src={clip.url}
            fallbackDuration={clip.durationSeconds}
            mode={viewStage === 'play' ? 'play' : 'preview'}
            onExpand={() => setStage('play')}
            onReturnToPreview={() => setStage('preview')}
            onError={setPreviewError}
          />
        ) : null}
        {!cameraVisible && !hasClip ? (
          <Text variant="footnote" tone="muted" className="video-note-module__placeholder">
            {viewStage === 'requesting' ? 'Подключаем камеру…' : 'Предпросмотр камеры'}
          </Text>
        ) : null}
        {(viewStage === 'recording' || viewStage === 'processing') ? (
          <VideoNoteRecordingRing progress={recorder.progress} />
        ) : null}
        {viewStage === 'recording' ? <div className="video-note-module__recording-dot" aria-label="Идёт запись" /> : null}
      </div>

      <Text variant="footnote" tone="muted" role="status">
        {viewStage === 'recording' || viewStage === 'processing'
          ? `Запись: ${Math.min(60, Math.ceil(recorder.elapsedMs / 1000))} / 60 сек.`
          : viewStage === 'preview' && clip
            ? `Предпросмотр: ${clip.durationSeconds} сек. Коснитесь кружка, чтобы воспроизвести.`
            : viewStage === 'play' && clip
              ? `Воспроизведение: ${clip.durationSeconds} сек. После окончания вернёмся к превью.`
              : 'Тестовый модуль: видео остаётся только на этом устройстве и не отправляется в чат.'}
      </Text>

      {hasClip && recorder.hasStream(facing) ? (
        <Text variant="footnote" tone="muted">
          Камера и микрофон остаются активны для повторной записи. «Сбросить» отключит их.
        </Text>
      ) : null}

      {clip?.capture && <Text variant="footnote" tone="muted">
        Кадр камеры {clip.capture.settings.width ?? '—'} × {clip.capture.settings.height ?? '—'}.
        Частота {clip.capture.settings.frameRate ?? '—'} кадр/с.
        {clip.capture.videoBitsPerSecond > 0 && ` Битрейт по данным рекордера ${clip.capture.videoBitsPerSecond} бит/с.`}
        {clip.capture.recorderMimeType && ` Формат ${clip.capture.recorderMimeType}.`}
      </Text>}

      {error ? <Text variant="footnote" role="alert">{error}</Text> : null}
      {showWebViewUpdate && <VideoWebViewUpdatePopover portal onClose={recorder.dismissUnsupportedFormat} />}

      <div className="video-note-module__actions">
        {(viewStage === 'idle' || viewStage === 'error') ? (
          <Button onClick={() => void beginRecording(facing)}>Записать кружок</Button>
        ) : null}
        {(viewStage === 'idle' || viewStage === 'preview' || viewStage === 'error') ? (
          <Button variant="secondary" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
            Сменить камеру
          </Button>
        ) : null}
        {viewStage === 'recording' ? <Button onClick={stopRecording}>Завершить запись</Button> : null}
        {viewStage === 'preview' && clip ? (
          <Button variant="secondary" onClick={() => void beginRecording(facing)}>Записать заново</Button>
        ) : null}
        {viewStage !== 'idle' && viewStage !== 'error' && viewStage !== 'requesting' ? (
          <Button variant="secondary" onClick={reset}>Сбросить</Button>
        ) : null}
      </div>
    </section>
  );
}
