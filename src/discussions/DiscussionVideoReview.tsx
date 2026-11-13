import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, FloatingActionButton, Text } from '../ui';
import { inspectVideoTrim, MIN_VIDEO_TRIM_SECONDS, trimRecordedMp4,
  type VideoTrimInfo, type VideoTrimRange } from '../media/videoTrim';
import type { VideoNoteRecording } from '../video-note/useVideoNoteRecorder';
import { useVideoTrimFilmstrip, VIDEO_TRIM_FRAME_COUNT } from './useVideoTrimFilmstrip';
import './discussion-video-review.css';

function videoTime(seconds: number) {
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')},${tenths % 10}`;
}

export function DiscussionVideoReview({ clip, onUse, onRetake, confirmStyle, retakeStyle }: {
  clip: VideoNoteRecording;
  onUse: (file: File) => void;
  onRetake: () => void;
  confirmStyle: CSSProperties;
  retakeStyle: CSSProperties;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const playAfterSeek = useRef(false);
  const exportRequest = useRef<AbortController | null>(null);
  const submitted = useRef(false);
  const [url, setUrl] = useState<string>();
  const [info, setInfo] = useState<VideoTrimInfo>();
  const [range, setRange] = useState<VideoTrimRange>({ start: 0, end: 0 });
  const [cursor, setCursor] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const frames = useVideoTrimFilmstrip(url, info?.duration ?? 0);

  useEffect(() => {
    const src = URL.createObjectURL(clip.blob);
    setUrl(src);
    const controller = new AbortController();
    void inspectVideoTrim(clip.blob, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setInfo(result);
      setRange({ start: 0, end: result.duration });
    }, () => {
      if (!controller.signal.aborted) setError('Обрезка этой записи недоступна. Можно использовать исходное видео.');
    });
    return () => {
      controller.abort();
      exportRequest.current?.abort();
      URL.revokeObjectURL(src);
    };
  }, [clip]);

  const seek = (time: number) => {
    if (!video.current) return;
    playAfterSeek.current = false;
    setPreviewPlaying(false);
    video.current.pause();
    video.current.currentTime = time;
    setCursor(time);
  };
  const playPreview = (player: HTMLVideoElement) => {
    void player.play().catch(() => {
      if (player.paused && !playAfterSeek.current) setPreviewPlaying(false);
    });
  };
  const togglePreview = () => {
    const player = video.current;
    if (!player) return;
    if (playAfterSeek.current || !player.paused) {
      playAfterSeek.current = false;
      player.pause();
      setPreviewPlaying(false);
      return;
    }

    setPreviewPlaying(true);
    if (player.currentTime < range.start || player.currentTime >= range.end) {
      player.currentTime = range.start;
    }
    // The seek target can already be in currentTime while the old frame is still displayed.
    if (player.seeking) {
      playAfterSeek.current = true;
      return;
    }
    playPreview(player);
  };
  const deliver = (blob: Blob, mimeType: string) => {
    if (submitted.current) return;
    submitted.current = true;
    onUse(new File([blob], 'Видео.mp4', { type: mimeType }));
  };
  const useOriginal = () => { if (!exportRequest.current) deliver(clip.blob, clip.mimeType); };
  const confirm = async () => {
    if (exportRequest.current || submitted.current) return;
    if (!info || (range.start === 0 && range.end === info.duration)) {
      useOriginal();
      return;
    }
    const controller = new AbortController();
    exportRequest.current = controller;
    setBusy(true);
    setError('');
    try {
      const blob = await trimRecordedMp4(clip.blob, info, range, controller.signal);
      if (!controller.signal.aborted) deliver(blob, 'video/mp4');
    } catch {
      if (!controller.signal.aborted) setError('Не удалось обрезать видео. Исходная запись доступна.');
    } finally {
      if (exportRequest.current === controller) exportRequest.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const duration = info?.duration ?? 0;
  const trimReady = info && duration > MIN_VIDEO_TRIM_SECONDS;
  const trimmedPreview = Boolean(trimReady && (range.start > 0 || range.end < duration));
  const timelineStyle = {
    '--trim-start': `${duration ? range.start / duration * 100 : 0}%`,
    '--trim-end': `${duration ? range.end / duration * 100 : 100}%`,
    '--trim-cursor': `${duration ? Math.min(cursor, duration) / duration * 100 : 0}%`,
  } as CSSProperties;

  return <>
    <div className="discussion-video-review">
      <video ref={video} src={url} controls={!trimmedPreview} controlsList="nofullscreen" playsInline aria-label="Предпросмотр записи"
        onSeeked={event => {
          const player = event.currentTarget;
          if (!playAfterSeek.current || player.seeking) return;
          playAfterSeek.current = false;
          playPreview(player);
        }}
        onPause={() => { if (!playAfterSeek.current) setPreviewPlaying(false); }}
        onEnded={() => setPreviewPlaying(false)}
        onError={() => { playAfterSeek.current = false; setPreviewPlaying(false); }}
        onTimeUpdate={event => {
          const player = event.currentTarget;
          if (trimmedPreview && !player.paused && player.currentTime >= range.end) {
            seek(range.end);
            return;
          }
          setCursor(player.currentTime);
        }} />
      <div className="discussion-video-review__footer">
        {trimReady && <>
          <div className="discussion-video-trim" style={timelineStyle}>
            <div className="discussion-video-trim__frames" aria-hidden="true">
              {Array.from({ length: VIDEO_TRIM_FRAME_COUNT }, (_, index) =>
                <span key={index}>{frames[index] && <img src={frames[index]} alt="" />}</span>)}
            </div>
            <div className="discussion-video-trim__selection" aria-hidden="true" />
            <div className="discussion-video-trim__cursor" aria-hidden="true" />
            <input type="range" className="discussion-video-trim__seek" min={0} max={duration} step="any"
              aria-label="Перемотка видео" aria-valuetext={videoTime(cursor)} disabled={busy}
              value={Math.min(cursor, duration)} onChange={event => {
                seek(Math.min(range.end, Math.max(range.start, Number(event.currentTarget.value))));
              }} />
            <input type="range" className="discussion-video-trim__start" min={0} max={duration} step="any"
              aria-label="Начало отрезка" aria-valuetext={videoTime(range.start)} disabled={busy} value={range.start}
              onChange={event => {
                const start = Math.max(0, Math.min(range.end - MIN_VIDEO_TRIM_SECONDS, Number(event.currentTarget.value)));
                setRange({ start, end: range.end });
                seek(start);
              }} />
            <input type="range" className="discussion-video-trim__end" min={0} max={duration} step="any"
              aria-label="Конец отрезка" aria-valuetext={videoTime(range.end)} disabled={busy} value={range.end}
              onChange={event => {
                const end = Math.min(duration, Math.max(range.start + MIN_VIDEO_TRIM_SECONDS, Number(event.currentTarget.value)));
                setRange({ start: range.start, end });
                seek(end);
              }} />
          </div>
          <Text variant="caption" className="discussion-video-trim__times">{videoTime(range.start)} — {videoTime(range.end)}</Text>
        </>}
        {trimmedPreview && <Button size="compact" onClick={togglePreview} disabled={busy}>
          {previewPlaying ? 'Пауза' : 'Воспроизвести отрезок'}
        </Button>}
        {busy && <Text variant="footnote" role="status">Готовим выбранный отрезок…</Text>}
        {error && <Text variant="footnote" role="alert">{error}</Text>}
        {error && info && <Button size="compact" onClick={useOriginal}>Использовать оригинал</Button>}
      </div>
    </div>
    <FloatingActionButton label="Удалить запись и записать заново" icon="x" style={retakeStyle} disabled={busy} onClick={onRetake} />
    <FloatingActionButton label="Использовать видео" icon="check" style={confirmStyle} disabled={!url || busy} onClick={() => void confirm()} />
  </>;
}
