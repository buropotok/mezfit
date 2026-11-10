import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FloatingActionButton, Icon } from '../ui';
import { Text } from '../ui/primitives';
import { useVideoNoteRecorder, type VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { VIDEO_RECORDING_PROFILES, type VideoRecordingProfile } from '../video-note/video-recording-profile';

const topControls: CSSProperties = { top: '1rem', bottom: 'auto' };
const centerControl: CSSProperties = { right: '50%', translate: '50% 0' };
const recordIconSize = { width: 28, height: 28 };

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
    {clip
      ? <video key="preview" src={previewUrl} controls playsInline aria-label="Предпросмотр записи" />
      : <video key="camera" ref={cameraPreview} autoPlay muted playsInline aria-label="Изображение с камеры" />}
    <FloatingActionButton label="Назад" icon="arrow-left" placement="left" style={topControls} onClick={onCancel} />
    {error && <Text variant="footnote" role="alert" className="discussion-video-recorder__status">{error}</Text>}
    {status === 'requesting' && <Text variant="footnote" role="status" className="discussion-video-recorder__status">Подключаем камеру…</Text>}
    {status === 'processing' && <Text variant="footnote" role="status" className="discussion-video-recorder__status">Готовим видео…</Text>}
    {status === 'recording' && <Text variant="footnote" className="discussion-video-recorder__status">{time} / {Math.floor(maxSeconds / 60)}:00</Text>}
    {status === 'recording' && <FloatingActionButton label="Остановить запись" style={centerControl} onClick={() => void stop()}>
      <Icon name="player-stop" className="discussion-video-recorder__record-icon" style={recordIconSize} />
    </FloatingActionButton>}
    {!inProgress && !clip && <>
      <FloatingActionButton label="Выбрать из галереи" icon="photo" onClick={onGallery} />
      {stream && status === 'idle'
        ? <FloatingActionButton label="Начать запись" style={centerControl} onClick={() => void start('environment')}>
          <Icon name="record-circle" className="discussion-video-recorder__record-icon" style={recordIconSize} />
        </FloatingActionButton>
        : <FloatingActionButton label="Включить камеру" icon="video" style={centerControl} onClick={enableCamera} />}
    </>}
    {clip && <>
      <FloatingActionButton label="Записать заново" icon="history" style={{ ...topControls, ...centerControl }}
        onClick={() => { setClip(null); enableCamera(); }} />
      <FloatingActionButton label="Использовать видео" icon="check" style={topControls} disabled={!previewUrl} onClick={() => {
        onUse(new File([clip.blob], 'Видео.mp4', { type: clip.mimeType }));
      }} />
    </>}
  </section>;
}
