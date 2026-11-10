import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from 'konsta/react';
import { IconButton, Text } from '../ui/primitives';
import { CircularVideoPlayback } from '../settings/CircularVideoPlayback';
import { VideoNoteRecordingRing } from '../settings/VideoNoteRing';
import type { DiscussionMediaCacheEntry } from '../media/discussionMediaCache';
import { useDiscussionMediaSource } from './useDiscussionMediaSource';
import '../settings/video-note-module.css';

/** Live circular camera viewport. The existing Settings ring is reused unchanged. */
export function DiscussionVideoNoteCapture({ stream, progress }: { stream: MediaStream | null; progress: number }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().catch(() => undefined);
    return () => { element.srcObject = null; };
  }, [stream]);
  return <div className="discussion-video-note-capture video-note-module__circle video-note-module__circle--expanded"
    role="status" aria-label="Идёт запись видеокружка">
    <video ref={video} className="video-note-module__video" autoPlay muted playsInline aria-label="Камера видеокружка" />
    <VideoNoteRecordingRing progress={progress} />
    <div className="video-note-module__recording-dot" aria-hidden="true" />
  </div>;
}

/** Sent/received circular attachment uses the existing round player and timeline. */
export function DiscussionVideoNote({ src, durationSeconds, cache, onMenu, meta }: {
  src: string;
  durationSeconds: number;
  cache?: DiscussionMediaCacheEntry;
  onMenu?: () => void;
  meta?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const { url, container } = useDiscussionMediaSource(src, cache, 'video', retry, false);
  return <div ref={container} className="discussion-video-note" data-expanded={expanded || undefined}
    onClick={event => event.stopPropagation()}>
    {url && <div className="discussion-video-note__circle video-note-module__circle">
      <CircularVideoPlayback key={retry} src={url} fallbackDuration={durationSeconds}
        mode={expanded ? 'play' : 'preview'} onExpand={() => setExpanded(true)}
        onReturnToPreview={() => setExpanded(false)} onError={setError} />
    </div>}
    {onMenu && <span className="discussion-video-note__menu">
      <IconButton icon="dots-vertical" label="Действия сообщения" onClick={event => {
        event.stopPropagation();
        onMenu();
      }} />
    </span>}
    {error && <div className="discussion-video-note__error">
      <Text variant="footnote" role="alert">{error}</Text>
      <Button rounded onClick={() => { setError(''); setRetry(value => value + 1); }}>
        <Text variant="footnote">Повторить</Text>
      </Button>
    </div>}
    {meta && <div className="discussion-video-note__meta">{meta}</div>}
  </div>;
}
