import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FloatingActionButton, Icon } from '../ui';
import { LiquidPopover } from '../ui/LiquidPopover';
import { useRecordingCountdown } from '../video-note/useRecordingCountdown';
import { Text } from '../ui/primitives';
import { useVideoNoteRecorder, type VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { DiscussionMediaStage } from './DiscussionMediaStage';
import { VIDEO_RECORDING_PROFILES } from '../video-note/video-recording-profile';

const topControls: CSSProperties = { top: 'calc(1rem + var(--discussion-media-safe-top))', bottom: 'auto' };
const bottomControls: CSSProperties = { bottom: 'calc(1rem + var(--discussion-media-safe-bottom))' };
const leftControl: CSSProperties = { left: 'calc(1rem + var(--discussion-media-safe-left))' };
const rightControl: CSSProperties = { right: 'calc(1rem + var(--discussion-media-safe-right))' };
const centerControl: CSSProperties = { ...bottomControls, right: '50%', translate: '50% 0' };
const recordIconSize = { width: 28, height: 28 };

interface Props {
  onCancel: () => void;
  onGallery: () => void;
  onUse: (file: File) => void;
}

function phoneVideoProfile(): 'portrait' | 'landscape' {
  const orientation = window.screen.orientation?.type;
  if (orientation) return orientation.startsWith('portrait') ? 'portrait' : 'landscape';
  return (window.matchMedia?.('(orientation: portrait)').matches ?? (window.innerHeight >= window.innerWidth))
    ? 'portrait' : 'landscape';
}

export function DiscussionVideoRecorder({ onCancel, onGallery, onUse }: Props) {
  const [profile] = useState(phoneVideoProfile);
  const [clip, setClip] = useState<VideoNoteRecording | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const cameraPreview = useRef<HTMLVideoElement>(null);
  const { start, stop, stream, status, error, elapsedMs } = useVideoNoteRecorder(setClip, profile, true);
  const delayTrigger = useRef<HTMLElement>(null);
  const [delayOpen, setDelayOpen] = useState(false);
  const [delayPresented, setDelayPresented] = useState(false);
  const beginRecording = () => {
    void start('environment', false, { video: cameraPreview.current, profile: phoneVideoProfile() });
  };
  const countdown = useRecordingCountdown(beginRecording);
  const countingDown = countdown.remaining !== null;
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
  const inProgress = status === 'recording' || status === 'processing' || status === 'requesting' || countingDown;

  useEffect(() => {
    if (inProgress || !stream || clip) setDelayOpen(false);
  }, [inProgress, stream, clip]);

  const canDelay = useRef(false);
  canDelay.current = !inProgress && !clip && status === 'idle' && Boolean(stream);

  return <DiscussionMediaStage label="Запись видео" className="discussion-video-recorder" fullscreen>
    {clip
      ? <video key="preview" src={previewUrl} controls controlsList="nofullscreen" playsInline aria-label="Предпросмотр записи" />
      : <video key="camera" ref={cameraPreview} autoPlay muted playsInline aria-label="Изображение с камеры" />}
    <FloatingActionButton label="Назад" icon="arrow-left" placement="left" style={{ ...topControls, ...leftControl }} onClick={onCancel} />
    {countingDown && <Text variant="headline" role="status" className="discussion-video-recorder__status">
      Запись через {countdown.remaining} сек.
    </Text>}
    {countingDown && <FloatingActionButton label="Отменить отсчёт" icon="x" style={centerControl} onClick={countdown.cancel} />}
    {error && <Text variant="footnote" role="alert" className="discussion-video-recorder__status">{error}</Text>}
    {status === 'requesting' && <Text variant="footnote" role="status" className="discussion-video-recorder__status">Подключаем камеру…</Text>}
    {status === 'processing' && <Text variant="footnote" role="status" className="discussion-video-recorder__status">Готовим видео…</Text>}
    {status === 'recording' && <Text variant="footnote" className="discussion-video-recorder__status">{time} / {Math.floor(maxSeconds / 60)}:00</Text>}
    {status === 'recording' && <FloatingActionButton label="Остановить запись" style={centerControl} onClick={() => void stop()}>
      <Icon name="player-stop" className="discussion-video-recorder__record-icon" style={recordIconSize} />
    </FloatingActionButton>}
    <LiquidPopover isOpen={delayOpen && !inProgress && !clip && Boolean(stream)} onOpenChange={setDelayOpen}
      triggerRef={delayTrigger} onPresentationChange={setDelayPresented} label="Задержка записи" layout="menu"
      items={[5, 10, 15].map(seconds => ({ id: String(seconds), label: `${seconds} сек.`, onSelect: () => {
        if (!canDelay.current) return;
        setDelayOpen(false);
        countdown.schedule(seconds);
      } }))}
      trigger={<FloatingActionButton ref={delayTrigger} label="Отложенная запись" icon="history" placement="left"
        isShown={!inProgress && !clip && status === 'idle' && Boolean(stream)}
        style={{ ...bottomControls, ...leftControl, visibility: delayPresented ? 'hidden' : undefined }} />} />
    {!inProgress && !clip && <>
      <FloatingActionButton label="Выбрать из галереи" disabled={delayOpen} icon="photo" style={{ ...bottomControls, ...rightControl }} onClick={onGallery} />
      {stream && status === 'idle'
        ? <FloatingActionButton label="Начать запись" disabled={delayOpen} style={centerControl} onClick={beginRecording}>
          <Icon name="record-circle" className="discussion-video-recorder__record-icon" style={recordIconSize} />
        </FloatingActionButton>
        : <FloatingActionButton label="Включить камеру" icon="video" style={centerControl} onClick={enableCamera} />}
    </>}
    {clip && <>
      <FloatingActionButton label="Удалить запись и записать заново" icon="x" style={{ ...centerControl, ...topControls }}
        onClick={() => { setClip(null); enableCamera(); }} />
      <FloatingActionButton label="Использовать видео" icon="check" style={{ ...topControls, ...rightControl }} disabled={!previewUrl} onClick={() => {
        onUse(new File([clip.blob], 'Видео.mp4', { type: clip.mimeType }));
      }} />
    </>}
  </DiscussionMediaStage>;
}
