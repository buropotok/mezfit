import { useState, type ReactNode } from 'react';
import { Button } from 'konsta/react';
import { IconButton, Text } from '../ui/primitives';

export interface DiscussionMediaSource {
  src: string;
  type: 'photo' | 'video';
  durationSeconds?: number | null;
}

export function DiscussionMedia({ src, type, durationSeconds, mode, onOpen, onMenu, meta }: DiscussionMediaSource & {
  mode: 'thumbnail' | 'preview' | 'viewer';
  onOpen?: () => void;
  onMenu?: () => void;
  meta?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const thumbnail = mode === 'thumbnail';
  const label = type === 'photo' ? 'Фото' : 'Видео';
  const duration = Math.floor(durationSeconds ?? 0);
  const content = type === 'photo'
    ? <img src={src} alt={mode === 'preview' ? 'Предпросмотр фото' : 'Фото во вложении'}
        loading={thumbnail ? 'lazy' : 'eager'} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <video src={src} aria-label={mode === 'preview' ? 'Предпросмотр видео' : 'Видео во вложении'}
        playsInline controls={!thumbnail} preload="metadata" onError={() => setFailed(true)} />;

  return <div className={`discussion-media discussion-media--${mode}`} onClick={event => event.stopPropagation()}>
    {failed ? <div className="discussion-media__error">
      <Text variant="footnote" role="status">
        {label} недоступно. Проверьте сеть и поддержку формата на устройстве.
      </Text>
      <Button rounded onClick={() => setFailed(false)}><Text variant="footnote">Повторить</Text></Button>
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
    {onMenu && <div className="discussion-media__menu">
      <IconButton icon="dots-vertical" label="Действия сообщения" onClick={onMenu} />
    </div>}
    {meta && <div className="discussion-media__meta">{meta}</div>}
  </div>;
}
