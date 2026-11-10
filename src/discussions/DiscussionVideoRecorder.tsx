import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { Text } from '../ui/primitives';
import { useVideoNoteRecorder, type VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { VIDEO_RECORDING_PROFILES, type VideoRecordingProfile } from '../video-note/video-recording-profile';

interface Props {
  onCancel: () => void;
  onGallery: () => void;
  onUse: (file: File) => void;
}

export function DiscussionVideoRecorder({ onCancel, onGallery, onUse }: Props) {
  const [profile] = useState<VideoRecordingProfile>(() =>
    (window.matchMedia?.('(orientation: portrait)').matches ?? (window.innerHeight >= window.innerWidth)) ? 'portrait' : 'landscape');
  const [clip, setClip] = useState<VideoNoteRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const cameraPreview = useRef<HTMLVideoElement>(null);
  const { start, stop, stream, status, error, elapsedMs } = useVideoNoteRecorder(setClip, profile);
  const maxSeconds = VIDEO_RECORDING_PROFILES[profile].maxDurationMs / 1000;

  const enableCamera = useCallback(() => { void start('environment', true); }, [start]);
  useEffect(enableCamera, [enableCamera]);

  useEffect(() => {
    const element = cameraPreview.current;
    if (!element) return;
    element.srcObject = stream;
    return () => { element.srcObject = null; };
  }, [stream, clip]);

  useEffect(() => {
    if (!clip) { setPreviewUrl(undefined); return; }
    const url = URL.createObjectURL(clip.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);

  const seconds = Math.floor(elapsedMs / 1000);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const inProgress = status === 'recording' || status === 'processing' || status === 'requesting';

  return <section className="discussion-media-stage discussion-media-stage--viewer discussion-video-recorder"
    aria-label="Запись видео">
    <Text variant="headline">Запись видео</Text>
    {clip
      ? <video src={previewUrl} controls playsInline aria-label="Предпросмотр записи" />
      : <video ref={cameraPreview} autoPlay muted playsInline aria-label="Изображение с камеры" />}
    {error && <Text variant="footnote" role="alert">{error}</Text>}
    {status === 'requesting' && <Text variant="footnote" role="status">Подключаем камеру…</Text>}
    {status === 'processing' && <Text variant="footnote" role="status">Готовим видео…</Text>}
    {status === 'recording' && <Text variant="footnote">{time} / {Math.floor(maxSeconds / 60)}:00</Text>}
    <div className="discussion-video-recorder__actions">
      <Button rounded tonal inline onClick={onCancel}><Text>Отменить</Text></Button>
      {status === 'recording' && <Button rounded inline onClick={() => void stop()}><Text>Остановить запись</Text></Button>}
      {!inProgress && !clip && <>
        <Button rounded tonal inline onClick={onGallery}><Text>Выбрать из галереи</Text></Button>
        {stream && status === 'idle'
          ? <Button rounded inline onClick={() => void start('environment')}><Text>Начать запись</Text></Button>
          : <Button rounded tonal inline onClick={enableCamera}><Text>Включить камеру</Text></Button>}
      </>}
      {clip && <>
        <Button rounded tonal inline onClick={() => { setClip(null); enableCamera(); }}><Text>Записать заново</Text></Button>
        <Button rounded inline disabled={!previewUrl} onClick={() => {
          onUse(new File([clip.blob], 'Видео.mp4', { type: clip.mimeType }));
        }}><Text>Использовать видео</Text></Button>
      </>}
    </div>
  </section>;
}
