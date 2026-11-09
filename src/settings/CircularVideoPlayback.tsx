import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function boundedFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Clockwise from the top, matching the circular video scrubber's visual arc. */
export function videoNoteSeekFraction(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): number {
  if (!bounds.width || !bounds.height) return 0;
  const x = clientX - (bounds.left + bounds.width / 2);
  const y = clientY - (bounds.top + bounds.height / 2);
  return (Math.atan2(y, x) / (2 * Math.PI) + 1.25) % 1;
}

interface CircularVideoPlaybackProps {
  src: string;
  fallbackDuration: number;
  onError: (message: string) => void;
}

/** Device-local playback: media surface and circular seek rail are not UIkit action primitives. */
export function CircularVideoPlayback({ src, fallbackDuration, onError }: CircularVideoPlaybackProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const railRef = useRef<SVGSVGElement>(null);
  const seekingPointerRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const aliveRef = useRef(true);
  const playGenerationRef = useRef(0);

  const [duration, setDuration] = useState(fallbackDuration);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [canSeek, setCanSeek] = useState(false);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      playGenerationRef.current += 1;
      video?.pause();
    };
  }, []);

  const readDuration = (video: HTMLVideoElement) => {
    const measured = video.duration;
    if (Number.isFinite(measured) && measured > 0) setDuration(measured);
    setCanSeek(video.readyState >= HTMLMediaElement.HAVE_METADATA);
  };

  const requestPlay = async (video: HTMLVideoElement) => {
    const generation = ++playGenerationRef.current;
    try {
      await video.play();
      if (aliveRef.current && generation === playGenerationRef.current) {
        setPlaying(!video.paused);
      }
    } catch {
      if (aliveRef.current && generation === playGenerationRef.current) {
        setPlaying(false);
        onError('Устройство не смогло воспроизвести этот видеоформат.');
      }
    }
  };

  const pause = (video: HTMLVideoElement) => {
    playGenerationRef.current += 1;
    video.pause();
    setPlaying(false);
  };

  const toggle = () => {
    const video = videoRef.current;
    if (!video || seekingPointerRef.current !== null) return;
    if (video.paused) void requestPlay(video);
    else pause(video);
  };

  const seekTo = (fraction: number) => {
    const video = videoRef.current;
    if (!video || !canSeek) return;
    const seconds = boundedFraction(fraction) * duration;
    if (!Number.isFinite(seconds) || duration <= 0) return;
    try {
      video.currentTime = seconds;
      setCurrentTime(seconds);
    } catch {
      onError('Перемотка не поддерживается для этого видео на устройстве.');
    }
  };

  const seekFromPointer = (event: PointerEvent<SVGCircleElement>) => {
    const bounds = railRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    seekTo(videoNoteSeekFraction(event.clientX, event.clientY, bounds));
  };

  const startScrubbing = (event: PointerEvent<SVGCircleElement>) => {
    const video = videoRef.current;
    if (!canSeek || !video || seekingPointerRef.current !== null) return;
    event.preventDefault();
    event.stopPropagation();
    seekingPointerRef.current = event.pointerId;
    wasPlayingRef.current = !video.paused;
    if (!video.paused) pause(video);
    setSeeking(true);
    seekFromPointer(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const finishScrubbing = (event: PointerEvent<SVGCircleElement>) => {
    if (seekingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    seekFromPointer(event);
    seekingPointerRef.current = null;
    setSeeking(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasPlayingRef.current && videoRef.current) void requestPlay(videoRef.current);
    wasPlayingRef.current = false;
  };

  const cancelScrubbing = (event: PointerEvent<SVGCircleElement>) => {
    if (seekingPointerRef.current !== event.pointerId) return;
    event.stopPropagation();
    seekingPointerRef.current = null;
    setSeeking(false);
    if (wasPlayingRef.current && videoRef.current) void requestPlay(videoRef.current);
    wasPlayingRef.current = false;
  };

  const handleSeekKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!canSeek || duration <= 0) return;
    const fraction = boundedFraction(currentTime / duration);
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') seekTo(fraction + 5 / duration);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') seekTo(fraction - 5 / duration);
    else if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(1);
    else return;
    event.preventDefault();
  };

  const progress = boundedFraction(currentTime / duration);
  const angle = 2 * Math.PI * progress - Math.PI / 2;
  const markerX = 50 + RING_RADIUS * Math.cos(angle);
  const markerY = 50 + RING_RADIUS * Math.sin(angle);

  return (
    <div className="video-note-playback">
      <video
        ref={videoRef}
        className="video-note-module__video"
        src={src}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => readDuration(event.currentTarget)}
        onDurationChange={(event) => readDuration(event.currentTarget)}
        onTimeUpdate={(event) => {
          if (seekingPointerRef.current === null) setCurrentTime(event.currentTarget.currentTime);
        }}
        onSeeked={(event) => {
          if (seekingPointerRef.current === null) setCurrentTime(event.currentTarget.currentTime);
        }}
        onPlay={() => { if (aliveRef.current) setPlaying(true); }}
        onPause={() => { if (aliveRef.current) setPlaying(false); }}
        onEnded={() => {
          if (aliveRef.current) {
            setPlaying(false);
            setCurrentTime(0);
            if (videoRef.current) videoRef.current.currentTime = 0;
          }
        }}
        onError={() => onError('Не удалось воспроизвести записанное видео на этом устройстве.')}
        aria-label="Записанный видеокружок"
      />
      <button
        type="button"
        className="video-note-playback__tap"
        onClick={toggle}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {!playing && !seeking ? <span className="video-note-playback__play-glyph" aria-hidden="true" /> : null}
      </button>
      <svg
        ref={railRef}
        className="video-note-playback__timeline"
        viewBox="0 0 100 100"
        role="slider"
        aria-label="Перемотка видеокружка"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={`${Math.round(currentTime)} из ${Math.round(duration)} секунд`}
        aria-disabled={!canSeek}
        tabIndex={canSeek ? 0 : -1}
        onKeyDown={handleSeekKeyDown}
      >
        <circle className="video-note-playback__track" cx="50" cy="50" r={RING_RADIUS} />
        <circle
          className="video-note-playback__progress"
          cx="50"
          cy="50"
          r={RING_RADIUS}
          strokeDasharray={`${progress * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          transform="rotate(-90 50 50)"
        />
        <circle className="video-note-playback__marker" cx={markerX} cy={markerY} r="2.25" />
        <circle
          className="video-note-playback__seek-hit"
          cx="50"
          cy="50"
          r={RING_RADIUS}
          onPointerDown={startScrubbing}
          onPointerMove={(event) => {
            if (seekingPointerRef.current === event.pointerId) seekFromPointer(event);
          }}
          onPointerUp={finishScrubbing}
          onPointerCancel={cancelScrubbing}
          onLostPointerCapture={cancelScrubbing}
        />
      </svg>
    </div>
  );
}
