import { useEffect, useState } from 'react';
import type { CatalogueExerciseRow } from '../data/exercises/coachExerciseTypes';
import { publicExerciseMediaUrl } from '../data/exercises/publicExerciseMedia';
import { isPersonalExerciseMediaUrl } from '../data/exercises/personalExerciseMediaReference';
import { loadPersonalExerciseMedia } from '../data/exercises/personalExerciseMediaCache';
import { Icon, Text } from '../ui';

export { publicExerciseMediaUrl } from '../data/exercises/publicExerciseMedia';
type Variant = 'thumbnail' | 'detail';
type MediaRow = Pick<CatalogueExerciseRow, 'id' | 'sourceSha256' | 'gif_url' | 'name' | 'name_ru'>
  & Partial<Pick<CatalogueExerciseRow,
    'media_id' | 'copiedFromExerciseId' | 'copiedFromScope' | 'image'>>;

export function exerciseImageUrl(row: MediaRow): string | null {
  if ((row.sourceSha256 === 'coach-custom' || row.sourceSha256 === 'assigned-coach-snapshot')
    && isPersonalExerciseMediaUrl(row.image)) return row.image;
  return publicExerciseMediaUrl(row);
}

/** Shared rendering for GIF, uploaded R2 imagery and a local-first cache on personal devices. */
export function PublicExerciseMedia({
  row, variant, mediaAccountId,
}: {
  row: MediaRow;
  variant: Variant;
  mediaAccountId?: string;
}) {
  const mediaUrl = exerciseImageUrl(row);
  const personal = isPersonalExerciseMediaUrl(mediaUrl);
  const [local, setLocal] = useState<{ source: string; url: string } | null>(null);
  const [cacheResolved, setCacheResolved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setCacheResolved(false);
    setLocal(null);
    if (!personal || !mediaUrl || !mediaAccountId) return undefined;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void loadPersonalExerciseMedia(mediaAccountId, mediaUrl, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        if (blob && typeof URL.createObjectURL === 'function') {
          try {
            objectUrl = URL.createObjectURL(blob);
            setLocal({ source: mediaUrl, url: objectUrl });
          } catch {
            // WebKit may reject a blob URL under memory pressure: use the R2 path.
          }
        }
        setCacheResolved(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaUrl, mediaAccountId, personal]);

  const waitingForCache = personal && Boolean(mediaAccountId) && !cacheResolved;
  const src = local?.source === mediaUrl ? local.url : mediaUrl;
  if (src && !failed && !waitingForCache) {
    return <img
      className={`mezfit-public-exercises__media-image mezfit-public-exercises__media-image--${variant}`}
      src={src}
      alt={variant === 'detail' ? (row.name_ru || row.name) : ''}
      loading={variant === 'detail' ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />;
  }
  if (variant === 'thumbnail') return <Icon name="barbell" />;
  return <>
    <Icon name="barbell" />
    {!waitingForCache && mediaUrl ? <Text tone="muted">Медиа недоступно</Text> : null}
  </>;
}
