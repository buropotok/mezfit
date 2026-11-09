import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { IconButton, Text } from '../ui';
import type { VoiceRecording } from './useVoiceRecorder';
import './voice-message-player.css';

export function formatVoiceDuration(seconds: number): string {
  const rounded = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}

export interface VoiceMessagePlayerProps {
  src: string;
  waveform: VoiceRecording['waveform'];
  durationMs: VoiceRecording['durationMs'];
  onError?: (message: string) => void;
}

/**
 * Bubble content only: Message owns bubble color, timestamp and delivery status.
 * This player can be reused in sent and received MezfitMessage instances.
 */
export function VoiceMessagePlayer({ src, waveform, durationMs, onError }: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekRef = useRef<SVGSVGElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(Math.max(0, durationMs / 1000));

  useEffect(() => {
    const audio = audioRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      audio?.pause();
    };
  }, []);

  useEffect(() => {
    // A virtualized message bubble may reuse the component for a different clip.
    generationRef.current += 1;
    // A fresh <audio> is already paused. Stop only a clip that was playing:
    // pausing on the initial mount is redundant and can emit spurious events.
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    setPosition(0);
    setPlaying(false);
    setDuration(Math.max(0, durationMs / 1000));
  }, [src, durationMs]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      generationRef.current += 1;
      audio.pause();
      setPlaying(false);
      return;
    }
    const generation = ++generationRef.current;
    try {
      await audio.play();
      if (mountedRef.current && generation === generationRef.current) setPlaying(!audio.paused);
    } catch {
      if (mountedRef.current && generation === generationRef.current) {
        setPlaying(false);
        onError?.('Не удалось воспроизвести голосовое сообщение на этом устройстве.');
      }
    }
  };

  const seek = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration) || duration <= 0) return;
    const time = Math.max(0, Math.min(1, fraction)) * duration;
    try {
      audio.currentTime = time;
      setPosition(time);
    } catch {
      onError?.('Перемотка аудио не поддерживается на этом устройстве.');
    }
  };

  const seekAt = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = seekRef.current?.getBoundingClientRect();
    if (bounds?.width) seek((event.clientX - bounds.left) / bounds.width);
  };

  const seekStart = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.stopPropagation();
    activePointerRef.current = event.pointerId;
    seekAt(event);
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* WebView fallback. */ }
  };

  const seekEnd = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    seekAt(event);
    activePointerRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch { /* Capture was already released by the WebView. */ }
  };

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;
  // Flat low bars mean the codec could not be analysed; never fabricate speech peaks.
  const bars = waveform.length > 0 ? waveform : Array.from({ length: 42 }, () => 0.08);

  return (
    <div
      className="voice-message-player"
      role="group"
      aria-label="Голосовое сообщение"
      onClick={(event) => event.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) {
            setDuration(event.currentTarget.duration);
          }
        }}
        onTimeUpdate={(event) => {
          if (activePointerRef.current === null) setPosition(event.currentTarget.currentTime);
        }}
        onSeeked={(event) => {
          if (activePointerRef.current === null) setPosition(event.currentTarget.currentTime);
        }}
        onPlay={() => { if (mountedRef.current) setPlaying(true); }}
        onPause={() => { if (mountedRef.current) setPlaying(false); }}
        onEnded={() => {
          if (!mountedRef.current) return;
          generationRef.current += 1;
          setPlaying(false);
          setPosition(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onError={() => onError?.('Не удалось загрузить голосовое сообщение.')}
        aria-label="Аудиозапись"
      />
      <IconButton
        label={playing ? 'Приостановить голосовое сообщение' : 'Воспроизвести голосовое сообщение'}
        color="gray"
        selected
        aria-pressed={playing}
        onClick={() => void toggle()}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="4" width="5" height="16" rx="1" />
            <rect x="14" y="4" width="5" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            <path d="M7 3.8a1.4 1.4 0 0 1 2.1-1.2l12 8.2a1.4 1.4 0 0 1 0 2.4l-12 8.2A1.4 1.4 0 0 1 7 20.2Z" />
          </svg>
        )}
      </IconButton>
      <div className="voice-message-player__body">
        <svg
          ref={seekRef}
          className="voice-message-player__waveform"
          viewBox={`0 0 ${bars.length * 5} 32`}
          preserveAspectRatio="none"
          role="slider"
          aria-label="Перемотка голосового сообщения"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuetext={`${formatVoiceDuration(position)} из ${formatVoiceDuration(duration)}`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') seek(progress + (duration ? 5 / duration : 0));
            else if (event.key === 'ArrowLeft') seek(progress - (duration ? 5 / duration : 0));
            else return;
            event.preventDefault();
          }}
          onPointerDown={seekStart}
          onPointerMove={(event) => {
            if (activePointerRef.current === event.pointerId) {
              event.preventDefault();
              seekAt(event);
            }
          }}
          onPointerUp={seekEnd}
          onPointerCancel={() => { activePointerRef.current = null; }}
          onLostPointerCapture={() => { activePointerRef.current = null; }}
        >
          {bars.map((height, index) => {
            const barHeight = 3 + Math.max(0, Math.min(1, height)) * 25;
            return (
              <rect
                key={index}
                x={index * 5 + 1}
                y={(32 - barHeight) / 2}
                width="3"
                height={barHeight}
                rx="1.5"
                className={index / bars.length <= progress ? 'voice-message-player__bar--played' : 'voice-message-player__bar'}
              />
            );
          })}
        </svg>
        <Text variant="footnote" className="voice-message-player__duration">
          {formatVoiceDuration(playing ? position : duration)}
        </Text>
      </div>
    </div>
  );
}
