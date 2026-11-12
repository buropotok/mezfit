import { useRef, useState, type ReactNode } from 'react';
import { Button } from 'konsta/react';
import { FloatingActionButton, IconButton, Text } from '../ui';
import { DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { copyAnnotationImage } from './discussion-annotation';
import { useDiscussionMediaSource } from './useDiscussionMediaSource';

export interface DiscussionMediaSource {
  src: string;
  type: 'photo' | 'video';
  durationSeconds?: number | null;
  cache?: DiscussionMediaCacheEntry;
}

function seekThumbnail(video: HTMLVideoElement) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  // Seek within short clips as well, without landing on the final boundary.
  video.currentTime = video.duration > 3 ? 3 : video.duration / 2;
}

export function DiscussionMedia({ src, type, durationSeconds, cache, mode, onOpen, onMenu, meta, autoPlay, startAt, onComment, showCommentHint, onAnnotate }: DiscussionMediaSource & {
  mode: 'thumbnail' | 'preview' | 'viewer';
  onOpen?: () => void;
  onMenu?: () => void;
  meta?: ReactNode;
  autoPlay?: boolean;
  startAt?: number;
  onComment?: (seconds: number) => void;
  showCommentHint?: boolean;
  onAnnotate?: (image: HTMLCanvasElement, seconds?: number) => void;
}) {
  const photo = useRef<HTMLImageElement>(null);
  const [imageReady, setImageReady] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [captureError, setCaptureError] = useState(false);
  const [usePlainSource, setUsePlainSource] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const thumbnail = mode === 'thumbnail';
  const autoCacheVideo = !thumbnail || (cache && cache.sizeBytes <= DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES);
  const { url: mediaSrc, container } = useDiscussionMediaSource(
    src, cache, type === 'photo' ? 'photo' : autoCacheVideo ? 'video' : 'cache-only', retry, thumbnail,
  );
  const crossOrigin = mode === 'viewer' && !autoPlay && !usePlainSource && mediaSrc?.startsWith('https:')
    ? 'anonymous' : undefined;
  function handleError() {
    setImageReady(false);
    setFrameReady(false);
    setPaused(false);
    if (crossOrigin) {
      // Some hosts support playback but do not allow reading pixels.
      setUsePlainSource(true);
    } else setFailed(true);
  }
  const annotate = () => {
    const video = type === 'video' ? player.current : null;
    const source = type === 'photo' ? photo.current : video;
    if (!source || !onAnnotate) return;
    if (video && (!video.paused || video.seeking || video.readyState < 2
      || !Number.isFinite(video.currentTime) || video.currentTime < 0)) return;
    const seconds = video?.currentTime;
    try {
      setCaptureError(false);
      onAnnotate(copyAnnotationImage(source), seconds);
    } catch {
      setCaptureError(true);
    }
  };
  const label = type === 'photo' ? 'Фото' : 'Видео';
  const duration = Math.floor(durationSeconds ?? 0);
  const content = type === 'photo'
    ? <img key={String(usePlainSource)} ref={photo} crossOrigin={crossOrigin} src={mediaSrc} alt={mode === 'preview' ? 'Предпросмотр фото' : 'Фото во вложении'}
        loading={thumbnail ? 'lazy' : 'eager'} referrerPolicy="no-referrer" onLoad={() => setImageReady(true)} onError={handleError} />
    : <video key={String(usePlainSource)} ref={player} crossOrigin={crossOrigin} src={mediaSrc} aria-label={mode === 'preview' ? 'Предпросмотр видео' : 'Видео во вложении'}
        playsInline autoPlay={startAt === undefined && autoPlay} controls={!thumbnail} controlsList="nofullscreen" preload={mode === 'viewer' ? 'auto' : 'metadata'}
        onLoadedData={() => setFrameReady(true)} onSeeking={() => setFrameReady(false)} onSeeked={() => setFrameReady(true)}
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          if (thumbnail) { seekThumbnail(video); return; }
          if (startAt !== undefined) {
            video.currentTime = Number.isFinite(video.duration) ? Math.min(startAt, video.duration) : startAt;
          }
          setPaused(video.paused && !autoPlay);
        }}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onEnded={() => setPaused(true)}
        onError={handleError} />;
  const comment = () => {
    const video = player.current;
    if (!onComment || !video?.paused || !Number.isFinite(video.currentTime) || video.currentTime < 0) return;
    onComment(video.currentTime);
  };

  return <div ref={container} className={`discussion-media discussion-media--${mode}`} onClick={event => event.stopPropagation()}>
    {failed ? <div className="discussion-media__error">
      <Text variant="footnote" role="status">
        {label} недоступно. Проверьте сеть и поддержку формата на устройстве.
      </Text>
      <Button rounded onClick={() => { setFailed(false); setUsePlainSource(false); setRetry(value => value + 1); }}><Text variant="footnote">Повторить</Text></Button>
    </div> : thumbnail ? <a href={src} className="discussion-media__open"
      aria-label={type === 'photo' ? 'Открыть фото' : 'Открыть видео'} onClick={event => {
        event.preventDefault();
        onOpen?.();
      }}>
      {content}
      {type === 'video' && <>
        <span className="discussion-media__play" aria-hidden="true" />
        {durationSeconds != null && <Text variant="caption" className="discussion-media__duration">
          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
        </Text>}
      </>}
    </a> : content}
    {onComment && paused && !failed && <div className="discussion-media__comment" data-hint={showCommentHint || undefined}>
      {showCommentHint && <Text variant="footnote" className="discussion-media__comment-hint">
        Нажмите, чтобы прокомментировать стопкадр.
      </Text>}
      <FloatingActionButton label="Прокомментировать стопкадр" icon="message-circle-exclamation"
        style={{ position: 'static', pointerEvents: 'auto' }} onClick={comment} />
    </div>}
    {onAnnotate && !failed && (type === 'photo' ? imageReady : paused) &&
      <div className="discussion-media__annotate">
        <IconButton icon="chart-dots-3" label="Рисовать на изображении"
          disabled={type === 'video' && !frameReady} onClick={annotate} />
        {captureError && <Text variant="footnote" role="alert">{usePlainSource
          ? 'Источник недоступен для разметки.'
          : 'Не удалось скопировать изображение. Повторите попытку.'}</Text>}
      </div>}
    {onMenu && <div className="discussion-media__menu">
      <IconButton icon="dots-vertical" label="Действия сообщения" onClick={onMenu} />
    </div>}
    {meta && <div className="discussion-media__meta">{meta}</div>}
  </div>;
}
