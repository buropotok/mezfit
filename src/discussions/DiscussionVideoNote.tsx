import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
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
export function DiscussionVideoNote({ src, durationSeconds, cache, onMenu, meta, playbackHost, scrollViewport, review = false }: {
  /** Unsent locked take stays expanded, including outside taps and playback end. */
  review?: boolean;
  /** Once attached, this sheet-owned portal target stays mounted for the whole discussion. */
  playbackHost?: HTMLElement | null;
  scrollViewport?: RefObject<HTMLDivElement | null>;
  src: string;
  durationSeconds: number;
  cache?: DiscussionMediaCacheEntry;
  onMenu?: () => void;
  meta?: ReactNode;
}) {
  const [previewAnchor, setPreviewAnchor] = useState<HTMLDivElement | null>(null);
  const circle = useRef<HTMLDivElement>(null);
  const [compactPlacement, setCompactPlacement] = useState<{
    top: number; left: number; right: number; bottom: number;
    '--note-left': string; '--note-top': string; '--note-width': string; '--note-expanded-height': string;
  }>();
  const [expanded, setExpanded] = useState(review);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const { url, container } = useDiscussionMediaSource(src, cache, 'video', retry, false);
  // The sheet rerenders on scroll, viewport resize and message-list resize.
  // Keep the portal target fixed and project the compact slot into that layer.
  useLayoutEffect(() => {
    if (!playbackHost || !url || (!review && !previewAnchor)) return;
    const host = playbackHost.getBoundingClientRect();
    const viewport = scrollViewport?.current?.getBoundingClientRect() ?? host;
    const anchor = previewAnchor?.getBoundingClientRect();
    const next = {
      top: viewport.top - host.top,
      left: viewport.left - host.left,
      right: host.right - viewport.right,
      bottom: host.bottom - viewport.bottom,
      '--note-left': `${(anchor?.left ?? viewport.left) - viewport.left}px`,
      '--note-top': `${(anchor?.top ?? viewport.top) - viewport.top}px`,
      '--note-width': `${anchor?.width ?? 0}px`,
      '--note-expanded-height': `${Math.max(0, host.bottom - viewport.top)}px`,
    };
    setCompactPlacement(previous => previous
      && previous.top === next.top && previous.left === next.left
      && previous.right === next.right && previous.bottom === next.bottom
      && previous['--note-left'] === next['--note-left']
      && previous['--note-top'] === next['--note-top']
      && previous['--note-width'] === next['--note-width']
      && previous['--note-expanded-height'] === next['--note-expanded-height'] ? previous : next);
  });

  useEffect(() => {
    if (!expanded || review) return;
    const outside = (event: PointerEvent) => {
      const element = circle.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const dx = event.clientX - bounds.left - bounds.width / 2;
      const dy = event.clientY - bounds.top - bounds.height / 2;
      const inside = bounds.width && bounds.height
        ? (dx * dx) / (bounds.width * bounds.width / 4) + (dy * dy) / (bounds.height * bounds.height / 4) <= 1
        : event.target instanceof Node && element.contains(event.target);
      if (!inside) setExpanded(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [expanded, review]);

  const menu = onMenu && <span className="discussion-video-note__menu">
    <IconButton icon="dots-vertical" label="Действия сообщения" onClick={event => {
      event.stopPropagation();
      onMenu();
    }} />
  </span>;
  const player = url && <div ref={circle}
    className={`discussion-video-note__circle video-note-module__circle${review ? ' discussion-video-note__circle--review' : ''}`}>
    <CircularVideoPlayback key={retry} src={url} fallbackDuration={durationSeconds}
      mode={expanded ? 'play' : 'preview'} previewControlHost={playbackHost ? previewAnchor : undefined}
      onExpand={() => setExpanded(true)}
      onReturnToPreview={review ? undefined : () => setExpanded(false)} onError={setError} />
  </div>;
  const placement: CSSProperties | undefined = expanded && compactPlacement
    ? { ...compactPlacement, left: 0, right: 0, bottom: 0 }
    : compactPlacement;

  return <div ref={container} className={`discussion-video-note${review ? ' discussion-video-note--review' : ''}`} data-expanded={expanded || undefined}
    onClick={event => event.stopPropagation()}>
    {!review && (playbackHost !== undefined || !player)
      && <div ref={setPreviewAnchor} className="discussion-video-note__inline" />}
    {playbackHost === undefined && player}
    {playbackHost && player && createPortal(
      <div className="discussion-video-note__layer" data-expanded={expanded || undefined}
        style={placement} hidden={!placement}>
        <div className="discussion-video-note__position">
          {player}
          {!expanded && menu}
        </div>
      </div>, playbackHost)}
    {(!playbackHost || !player || expanded) && menu}
    {error && <div className="discussion-video-note__error">
      <Text variant="footnote" role="alert">{error}</Text>
      <Button rounded onClick={() => { setError(''); setRetry(value => value + 1); }}>
        <Text variant="footnote">Повторить</Text>
      </Button>
    </div>}
    {meta && <div className="discussion-video-note__meta">{meta}</div>}
  </div>;
}
