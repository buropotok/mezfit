import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Button } from 'konsta/react';
import { FloatingActionButton, IconButton, Text } from '../ui';
import { DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { copyAnnotationImage } from './discussion-annotation';
import { useDiscussionMediaSource } from './useDiscussionMediaSource';
import { useVideoOrientation } from '../media/useVideoOrientation';
import { DiscussionVideoControls } from './DiscussionVideoControls';

interface DiscussionPhotoSource {
  src: string;
  cache?: DiscussionMediaCacheEntry;
}

export interface DiscussionMediaSource extends DiscussionPhotoSource {
  type: 'photo' | 'video';
  durationSeconds?: number | null;
  photoPreview?: DiscussionPhotoSource;
}

function ViewerPhotoPreview({ src, cache }: DiscussionPhotoSource) {
  const { url, tryR2Fallback } = useDiscussionMediaSource(src, cache, 'photo', 0, false);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  return url ? <img key={url} src={url} alt="Миниатюра фото" referrerPolicy="no-referrer"
    style={{ visibility: loadedUrl === url ? 'visible' : 'hidden' }}
    onLoad={() => setLoadedUrl(url)} onError={() => { setLoadedUrl(undefined); void tryR2Fallback(); }} /> : null;
}

function seekThumbnail(video: HTMLVideoElement) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  // Seek within short clips as well, without landing on the final boundary.
  video.currentTime = video.duration > 3 ? 3 : video.duration / 2;
}

export function DiscussionMedia({ src, type, durationSeconds, cache, photoPreview, mode, onOpen, onMenu, meta, autoPlay, startAt, onComment, showCommentHint, onAnnotate }: DiscussionMediaSource & {
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
  const currentRetry = useRef(retry);
  currentRetry.current = retry;
  const thumbnail = mode === 'thumbnail';
  const viewerPreview = type === 'photo' && mode === 'viewer' ? photoPreview : undefined;
  const autoCacheVideo = !thumbnail || (cache && cache.sizeBytes <= DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES);
  const { url: mediaSrc, container, tryR2Fallback } = useDiscussionMediaSource(
    src, cache, type === 'photo' ? 'photo' : autoCacheVideo ? 'video' : 'cache-only', retry, thumbnail,
  );
  const crossOrigin = mode === 'viewer' && !autoPlay && !usePlainSource && mediaSrc?.startsWith('https:')
    ? 'anonymous' : undefined;
  const orientation = useVideoOrientation(player, type === 'video' ? mediaSrc : undefined, 'contain',
    `${usePlainSource}:${failed}:${retry}:${mode}`);
  function handleError() {
    setImageReady(false);
    setFrameReady(false);
    setPaused(false);
    if (crossOrigin) {
      // Some hosts support playback but do not allow reading pixels.
      setUsePlainSource(true);
    } else {
      const attempt = retry;
      void tryR2Fallback().then(switched => {
        if (!switched && currentRetry.current === attempt) setFailed(true);
      });
    }
  }
  const reportOrientationError = useEffectEvent(handleError);
  useEffect(() => {
    if (orientation.error) reportOrientationError();
  }, [orientation.error]);
  const annotate = () => {
    const video = type === 'video' ? player.current : null;
    const source = type === 'photo' ? photo.current : video;
    if (!source || !onAnnotate) return;
    if (video && video.videoWidth > 0 && orientation.pending) return;
    if (video && (!video.paused || video.seeking || video.readyState < 2
      || !Number.isFinite(video.currentTime) || video.currentTime < 0)) return;
    const seconds = video?.currentTime;
    try {
      setCaptureError(false);
      const image = video && orientation.flip ? copyAnnotationImage(source, orientation.rotation, true)
        : video && orientation.rotation ? copyAnnotationImage(source, orientation.rotation) : copyAnnotationImage(source);
      onAnnotate(image, seconds);
    } catch {
      setCaptureError(true);
    }
  };
  const label = type === 'photo' ? 'Фото' : 'Видео';
  const duration = Math.floor(durationSeconds ?? 0);
  const content = type === 'photo'
    ? <img key={String(usePlainSource)} ref={photo} crossOrigin={crossOrigin} src={mediaSrc} alt={mode === 'preview' ? 'Предпросмотр фото' : 'Фото во вложении'}
        style={viewerPreview && !imageReady ? { visibility: 'hidden' } : undefined}
        loading={thumbnail ? 'lazy' : 'eager'} referrerPolicy="no-referrer" onLoad={() => setImageReady(true)} onError={handleError} />
    : <video key={String(usePlainSource)} ref={player} crossOrigin={crossOrigin} src={orientation.src} aria-label={mode === 'preview' ? 'Предпросмотр видео' : 'Видео во вложении'}
        style={orientation.style}
        playsInline autoPlay={startAt === undefined && autoPlay} preload={mode === 'viewer' ? 'auto' : 'metadata'}
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
  const retryButton = <Button rounded onClick={() => {
    setFailed(false); setUsePlainSource(false); setRetry(value => value + 1);
  }}><Text variant="body">Повторить</Text></Button>;

  return <div ref={container} className={`discussion-media discussion-media--${mode}`} onClick={event => event.stopPropagation()}>
    {viewerPreview && !imageReady && <ViewerPhotoPreview {...viewerPreview} />}
    {viewerPreview && !imageReady && <div className="discussion-media__photo-status">
      <Text variant="footnote" role="status">
        {failed
          ? `Не удалось открыть оригинал фото. Код ${mediaSrc?.startsWith('blob:') ? 'PHOTO-FULL-DECODE' : 'PHOTO-FULL-LOAD'}`
          : 'Загружаем оригинал фото…'}
      </Text>
      {failed && retryButton}
    </div>}
    {failed && !viewerPreview && <div className="discussion-media__error">
      <Text variant="footnote" role="status">
        {label} недоступно. Проверьте сеть и поддержку формата на устройстве.
      </Text>
      {retryButton}
    </div>}
    {!failed && (thumbnail ? <a href={src} className="discussion-media__open"
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
    </a> : (!viewerPreview || mediaSrc) && content)}
    {type === 'video' && orientation.pending && !failed && <div className="discussion-media__preparing">
      <Text variant="caption">Подготавливаем видео…</Text>
    </div>}
    {type === 'video' && !thumbnail && !failed &&
      <DiscussionVideoControls key={`controls:${usePlainSource}`} player={player} source={orientation.src} />}
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
          disabled={type === 'video' && (!frameReady || Boolean(player.current?.videoWidth && orientation.pending))} onClick={annotate} />
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
