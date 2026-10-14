import { useEffect, useState } from 'react';
import type { PublicExerciseRow } from '../data/exercises/publicExerciseTypes';
import { Icon, Text } from '../ui';

/** Only the approved immutable Dexie catalogue may reference the existing media library. */
const PUBLIC_CATALOGUE_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const MEDIA_APPROVED = import.meta.env.VITE_PUBLIC_EXERCISE_MEDIA_APPROVED === 'true';

type MediaIdentity = Pick<PublicExerciseRow, 'id' | 'sourceSha256' | 'gif_url'>;
type MediaExercise = MediaIdentity & Pick<PublicExerciseRow, 'name' | 'name_ru'>;
type Variant = 'thumbnail' | 'detail';

/**
 * A verified Dexie row identifies a previously imported canonical dataset GIF
 * by its stable four-digit ID, never by treating gif_url as a remote URL.
 * The existing Worker authorizes the D1 media mapping and loads the R2 bytes.
 * Feature-gated until media redistribution rights are confirmed.
 */
export function publicExerciseMediaUrl(
  row: MediaIdentity,
  approved = MEDIA_APPROVED,
): string | null {
  if (!approved || !/^\d{4}$/.test(row.id)
    || row.sourceSha256 !== PUBLIC_CATALOGUE_SHA
    || typeof row.gif_url !== 'string' || !row.gif_url.trim()) return null;
  return `/api/exercise-media/gym_keeper_apk/${row.id}`;
}

/** Shared rendering for list thumbnails and the full exercise detail. */
export function PublicExerciseMedia({
  row, variant, approved,
}: {
  row: MediaExercise;
  variant: Variant;
  approved?: boolean;
}) {
  const mediaUrl = publicExerciseMediaUrl(row, approved);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [mediaUrl]);

  if (mediaUrl && !failed) {
    return (
      <img
        className={`mezfit-public-exercises__media-image mezfit-public-exercises__media-image--${variant}`}
        src={mediaUrl}
        alt={variant === 'detail' ? (row.name_ru || row.name) : ''}
        loading={variant === 'detail' ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  if (variant === 'thumbnail') return <Icon name="barbell" />;

  return (
    <>
      <Icon name="barbell" />
      <Text tone="muted">{mediaUrl ? 'Медиа недоступно' : 'Медиа появится после подтверждения прав'}</Text>
    </>
  );
}
