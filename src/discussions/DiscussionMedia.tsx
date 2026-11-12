import { useRef, useState, type ReactNode } from 'react';
import { Button } from 'konsta/react';
import { FloatingActionButton, IconButton, Text } from '../ui';
import { DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES, type DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
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

export function DiscussionMedia({ src, type, durationSeconds, cache, mode, onOpen, onMenu, meta, autoPlay, startAt, onComment, showCommentHint }: DiscussionMediaSource & {
  mode: 'thumbnail' | 'preview' | 'viewer';
  onOpen?: () => void;
  onMenu?: () => void;
  meta?: ReactNode;
  autoPlay?: boolean;
  startAt?: number;
  onComment?: (seconds: number) => void;
  showCommentHint?: boolean;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const thumbnail = mode === 'thumbnail';
  const autoCacheVideo = !thumbnail || (cache && cache.sizeBytes <= DISCUSSION_VIDEO_THUMBNAIL_CACHE_MAX_BYTES);
  const { url: mediaSrc, container } = useDiscussionMediaSource(
    src, cache, type === 'photo' ? 'photo' : autoCacheVideo ? 'video' : 'cache-only', retry, thumbnail,
  );
  const label = type === 'photo' ? 'Фото' : 'Видео';
  const duration = Math.floor(durationSeconds ?? 0);
  const content = type === 'photo'
    ? <img src={mediaSrc} alt={mode === 'preview' ? 'Предпросмотр фото' : 'Фото во вложении'}
        loading={thumbnail ? 'lazy' : 'eager'} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <video ref={player} src={mediaSrc} aria-label={mode === 'preview' ? 'Предпросмотр видео' : 'Видео во вложении'}
        playsInline autoPlay={startAt === undefined && autoPlay} controls={!thumbnail} controlsList="nofullscreen" preload="metadata"
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          if (thumbnail) { seekThumbnail(video); return; }
          if (startAt !== undefined) {
            video.currentTime = Number.isFinite(video.duration) ? Math.min(startAt, video.duration) : startAt;
          }
          setPaused(video.paused && !autoPlay);
        }}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onEnded={() => setPaused(true)}
        onError={() => { setPaused(false); setFailed(true); }} />;
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
      <Button rounded onClick={() => { setFailed(false); setRetry(value => value + 1); }}><Text variant="footnote">Повторить</Text></Button>
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
    {onMenu && <div className="discussion-media__menu">
      <IconButton icon="dots-vertical" label="Действия сообщения" onClick={onMenu} />
    </div>}
    {meta && <div className="discussion-media__meta">{meta}</div>}
  </div>;
}
