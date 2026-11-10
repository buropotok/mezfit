import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { VideoNoteRing, VIDEO_NOTE_RING_RADIUS } from './VideoNoteRing';

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

export type VideoNotePlaybackMode = 'preview' | 'play';

interface CircularVideoPlaybackProps {
  src: string;
  fallbackDuration: number;
  onError: (message: string) => void;
  mode?: VideoNotePlaybackMode;
  onExpand?: () => void;
  onReturnToPreview?: () => void;
}

/** Device-local playback: media surface and circular seek rail are not UIkit action primitives. */
export function CircularVideoPlayback({
  src,
  fallbackDuration,
  onError,
  mode = 'play',
  onExpand,
  onReturnToPreview,
}: CircularVideoPlaybackProps) {
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

  useEffect(() => {
    if (mode !== 'preview') return;
    playGenerationRef.current += 1;
    videoRef.current?.pause();
    setPlaying(false);
    seekingPointerRef.current = null;
    wasPlayingRef.current = false;
    setSeeking(false);
  }, [mode]);

  // timeupdate is sparse on mobile WebViews; sample the actual frame time while playing.
  useEffect(() => {
    if (!playing || typeof window.requestAnimationFrame !== 'function') return undefined;
    let active = true;
    let frame = 0;
    const advance = () => {
      if (!active) return;
      const video = videoRef.current;
      if (video && seekingPointerRef.current === null && Number.isFinite(video.currentTime)) {
        setCurrentTime(video.currentTime);
      }
      frame = window.requestAnimationFrame(advance);
    };
    frame = window.requestAnimationFrame(advance);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [playing]);

  // React's delegated touch handlers may be passive in mobile WebViews.
  // Keep the cancellation local to this seek surface, never to the page.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const blockScrollDuringScrub = (event: TouchEvent) => {
      if (seekingPointerRef.current !== null && event.cancelable) event.preventDefault();
    };
    rail.addEventListener('touchmove', blockScrollDuringScrub, { passive: false });
    return () => rail.removeEventListener('touchmove', blockScrollDuringScrub);
  }, [mode]);

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
        onReturnToPreview?.();
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
    if (mode === 'preview') {
      // Play in the user's tap handler, before React animates the circle outward.
      onExpand?.();
      void requestPlay(video);
      return;
    }
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
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Some embedded WebViews can decline capture; a tap on the rail still seeks.
    }
  };

  const finishScrubbing = (event: PointerEvent<SVGCircleElement>) => {
    if (seekingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    seekFromPointer(event);
    seekingPointerRef.current = null;
    setSeeking(false);
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The WebView may have released capture before pointerup.
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

  const showPreviewFrame = (video: HTMLVideoElement) => {
    // iOS WebKit may show a black video until seeking just past time zero.
    // Keep the clip paused: this is only a first-frame decode workaround.
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      const frameTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(0.04, video.duration / 2)
        : 0.04;
      try { video.currentTime = frameTime; } catch { /* Still waiting for decodable data. */ }
    }
  };

  return (
    <div className={`video-note-playback${mode === 'preview' ? ' video-note-playback--preview' : playing ? '' : ' video-note-playback--paused'}`}>
      <video
        ref={videoRef}
        className="video-note-module__video"
        src={src}
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => {
          readDuration(event.currentTarget);
          if (mode === 'preview') showPreviewFrame(event.currentTarget);
        }}
        onDurationChange={(event) => readDuration(event.currentTarget)}
        onTimeUpdate={(event) => {
          if (seekingPointerRef.current === null) setCurrentTime(event.currentTarget.currentTime);
        }}
        onSeeked={(event) => {
          if (seekingPointerRef.current === null) setCurrentTime(event.currentTarget.currentTime);
        }}
        onPlay={(event) => {
          if (aliveRef.current && !event.currentTarget.paused && seekingPointerRef.current === null) {
            setPlaying(true);
          }
        }}
        onPause={() => { if (aliveRef.current) setPlaying(false); }}
        onEnded={() => {
          if (aliveRef.current) {
            // Invalidate an unresolved play() attempt before collapsing to Preview.
            playGenerationRef.current += 1;
            setPlaying(false);
            setCurrentTime(0);
            const video = videoRef.current;
            if (video) {
              video.currentTime = onReturnToPreview && Number.isFinite(video.duration)
                ? Math.min(0.04, video.duration / 2)
                : 0;
            }
            onReturnToPreview?.();
          }
        }}
        onError={() => onError('Не удалось воспроизвести записанное видео на этом устройстве.')}
        aria-label="Записанный видеокружок"
      />
      <button
        type="button"
        className="video-note-playback__tap"
        onClick={toggle}
        aria-label={mode === 'preview' ? 'Открыть видеокружок' : playing ? 'Пауза' : 'Воспроизвести'}
      >
        {mode !== 'preview' && !playing && !seeking ? (
          <span className="video-note-playback__play-glyph" aria-hidden="true" />
        ) : null}
      </button>
      {mode === 'play' ? <svg
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
        <VideoNoteRing progress={progress} mode={playing ? 'playing' : 'paused'}>
          <circle
            className="video-note-playback__seek-hit"
            cx="50"
            cy="50"
            r={VIDEO_NOTE_RING_RADIUS}
            onPointerDown={startScrubbing}
            onPointerMove={(event) => {
              if (seekingPointerRef.current === event.pointerId) {
                event.preventDefault();
                seekFromPointer(event);
              }
            }}
            onPointerUp={finishScrubbing}
            onPointerCancel={cancelScrubbing}
            onLostPointerCapture={cancelScrubbing}
          />
        </VideoNoteRing>
      </svg> : null}
    </div>
  );
}
