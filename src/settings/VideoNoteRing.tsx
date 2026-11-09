import type { ReactNode } from 'react';

export const VIDEO_NOTE_RING_RADIUS = 48.2;
const RING_CIRCUMFERENCE = 2 * Math.PI * VIDEO_NOTE_RING_RADIUS;

export type VideoNoteRingMode = 'recording' | 'playing' | 'paused';

interface VideoNoteRingProps {
  progress: number;
  mode: VideoNoteRingMode;
  children?: ReactNode;
}

/** Shared media decoration. The paused state scales the whole rail inwards,
 * including the draggable hit area; ordinary UIkit controls remain unchanged.
 */
export function VideoNoteRing({ progress, mode, children }: VideoNoteRingProps) {
  const fraction = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const angle = 2 * Math.PI * fraction - Math.PI / 2;
  const markerX = 50 + VIDEO_NOTE_RING_RADIUS * Math.cos(angle);
  const markerY = 50 + VIDEO_NOTE_RING_RADIUS * Math.sin(angle);

  return (
    <g className={`video-note-ring video-note-ring--${mode}`}>
      <circle className="video-note-ring__track" cx="50" cy="50" r={VIDEO_NOTE_RING_RADIUS} />
      <circle
        className="video-note-ring__progress"
        cx="50"
        cy="50"
        r={VIDEO_NOTE_RING_RADIUS}
        strokeDasharray={`${fraction * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 50 50)"
      />
      {mode !== 'recording' ? (
        <circle
          className="video-note-playback__marker"
          cx={markerX}
          cy={markerY}
          r="2.35"
        />
      ) : null}
      {children}
    </g>
  );
}

/** Recording shares the same outer-edge indicator without an interactive seek rail. */
export function VideoNoteRecordingRing({ progress }: { progress: number }) {
  return (
    <svg
      className="video-note-playback__timeline video-note-module__recording-ring"
      viewBox="0 0 100 100"
      aria-label="Прогресс записи видеокружка"
      role="img"
    >
      <VideoNoteRing progress={progress} mode="recording" />
    </svg>
  );
}
