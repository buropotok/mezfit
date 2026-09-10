import { useEffect, useState, type CSSProperties } from 'react';
import type { ExerciseDefinition } from './api';
import { exerciseDisplayName } from './exerciseLocalization';
import { gymKeeperIcons } from './gymKeeperIcons';

export type ExerciseMediaVariant = 'thumbnail' | 'detail' | 'editor';

function iconStyle(url: string): CSSProperties {
  return { '--exercise-action-icon': url } as CSSProperties;
}

export function exerciseMediaUrl(exercise: Pick<ExerciseDefinition, 'reference_source' | 'reference_key'>): string | null {
  if (exercise.reference_source !== 'gym_keeper_apk' || !exercise.reference_key) return null;
  return `/api/exercise-media/gym_keeper_apk/${encodeURIComponent(exercise.reference_key)}`;
}

export function ExerciseMedia({
  exercise,
  variant = 'thumbnail',
  decorative = variant !== 'detail',
}: {
  exercise: ExerciseDefinition;
  variant?: ExerciseMediaVariant;
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const mediaUrl = exerciseMediaUrl(exercise);

  useEffect(() => {
    setFailed(false);
  }, [exercise.id, mediaUrl]);

  if (mediaUrl && !failed) {
    return (
      <img
        className={`exercise-media-image exercise-media-image-${variant}`}
        src={mediaUrl}
        alt={decorative ? '' : exerciseDisplayName(exercise)}
        loading={variant === 'detail' ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={`exercise-action-icon exercise-media-icon exercise-media-fallback exercise-media-fallback-${variant}`}
      style={iconStyle(gymKeeperIcons.exercises)}
      aria-hidden="true"
    />
  );
}
