import { useEffect, useState } from 'react';
import type { CatalogueExerciseRow } from '../data/exercises/coachExerciseTypes';
import { publicExerciseMediaUrl } from '../data/exercises/publicExerciseMedia';
import { Icon, Text } from '../ui';

export { publicExerciseMediaUrl } from '../data/exercises/publicExerciseMedia';
type Variant = 'thumbnail' | 'detail';

/** Shared rendering for list thumbnails and the full exercise detail. */
export function PublicExerciseMedia({
  row, variant,
}: {
  row: Pick<CatalogueExerciseRow, 'id' | 'sourceSha256' | 'gif_url' | 'name' | 'name_ru'> & Partial<Pick<CatalogueExerciseRow, 'media_id' | 'copiedFromExerciseId' | 'copiedFromScope'>>;
  variant: Variant;
}) {
  const mediaUrl = publicExerciseMediaUrl(row);
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
      <Text tone="muted">Медиа недоступно</Text>
    </>
  );
}
