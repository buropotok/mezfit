import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ExerciseDefinition } from './api';
import { exerciseDisplayName } from './exerciseLocalization';
import { useCachedMediaUrl } from './data/media/useCachedMediaUrl';
import { gymKeeperIcons } from './gymKeeperIcons';

export type ExerciseMediaVariant = 'thumbnail' | 'category' | 'detail' | 'editor';

function iconStyle(url: string): CSSProperties {
  return { '--exercise-action-icon': url } as CSSProperties;
}

export function exerciseMediaUrl(
  exercise: Pick<ExerciseDefinition, 'reference_source' | 'reference_key'>
    & Partial<Pick<ExerciseDefinition, 'reference_media_url'>>,
): string | null {
  if (exercise.reference_source === 'github_exercises_dataset' && exercise.reference_key) {
    return `/api/exercise-media/gym_keeper_apk/${encodeURIComponent(exercise.reference_key)}`;
  }
  return exercise.reference_media_url ?? null;
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
  const [thumbnailVisible, setThumbnailVisible] = useState(variant !== 'thumbnail');
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const mediaUrl = exerciseMediaUrl(exercise);
  const cachedMediaUrl = useCachedMediaUrl(thumbnailVisible ? mediaUrl : null);

  useEffect(() => {
    if (variant !== 'thumbnail') {
      setThumbnailVisible(true);
      return undefined;
    }
    const element = placeholderRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setThumbnailVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setThumbnailVisible(true);
        observer.disconnect();
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [exercise.id, variant]);

  useEffect(() => {
    setFailed(false);
  }, [exercise.id, mediaUrl]);

  if (cachedMediaUrl && !failed) {
    return (
      <img
        className={`exercise-media-image exercise-media-image-${variant}`}
        src={cachedMediaUrl}
        alt={decorative ? '' : exerciseDisplayName(exercise)}
        loading={variant === 'detail' ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      ref={placeholderRef}
      className={`exercise-action-icon exercise-media-icon exercise-media-fallback exercise-media-fallback-${variant}`}
      style={iconStyle(gymKeeperIcons.exercises)}
      aria-hidden="true"
    />
  );
}
