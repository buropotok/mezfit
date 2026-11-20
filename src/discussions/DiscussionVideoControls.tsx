import { useEffect, useRef, useState, type RefObject } from 'react';
import { IconButton, MezfitSlider, Text } from '../ui';

export function DiscussionVideoControls({ player, source }: {
  player: RefObject<HTMLVideoElement | null>; source: string | undefined;
}) {
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playFailed, setPlayFailed] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const video = player.current;
    if (!video) return;
    setPlayFailed(false);
    const update = () => {
      setPaused(video.paused);
      setPosition(Number.isFinite(video.currentTime) ? video.currentTime : 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const events = ['loadedmetadata', 'emptied', 'timeupdate', 'play', 'pause', 'ended', 'durationchange', 'seeked'] as const;
    events.forEach(event => video.addEventListener(event, update));
    update();
    return () => {
      generation.current += 1;
      events.forEach(event => video.removeEventListener(event, update));
    };
  }, [player, source]);
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  return <div className="discussion-media__video-controls">
    <IconButton label={paused ? 'Воспроизвести' : 'Пауза'} disabled={!source}
      onClick={() => {
        const video = player.current;
        if (!video) return;
        const attempt = ++generation.current;
        setPlayFailed(false);
        if (video.paused) void video.play().catch(() => {
          if (generation.current === attempt) setPlayFailed(true);
        });
        else video.pause();
      }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
        {paused ? <path d="M7 4v16l14-8z" /> : <path d="M6 4h4v16H6zM14 4h4v16h-4z" />}
      </svg>
    </IconButton>
    <div className="discussion-media__video-seek">
      <MezfitSlider size="small" fullWidth start={0} end={100} ariaLabel="Перемотка видео"
        value={duration > 0 ? position / duration * 100 : 0}
        onValueChange={value => {
          if (player.current && duration > 0) player.current.currentTime = value / 100 * duration;
        }} />
    </div>
    <Text variant="caption" className="discussion-media__video-time">{time(position)} / {time(duration)}</Text>
    {playFailed && <Text variant="footnote" role="alert" className="discussion-media__video-error">Не удалось запустить видео. Повторите попытку.</Text>}
  </div>;
}
