import type { CatalogueExerciseRow } from './coachExerciseTypes';
import approvedMediaRelease from '../../../shared/approved-exercise-media.json';

/** Only the approved immutable Dexie catalogue may reference the existing media library. */
const PUBLIC_CATALOGUE_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';

type MediaIdentity = Pick<CatalogueExerciseRow, 'id' | 'sourceSha256' | 'gif_url'> & Partial<Pick<CatalogueExerciseRow, 'media_id' | 'copiedFromExerciseId' | 'copiedFromScope'>>;

/**
 * A verified Dexie row identifies a previously imported canonical dataset GIF
 * by its stable four-digit ID, never by treating gif_url as a remote URL.
 * The existing Worker authorizes the D1 media mapping and loads the R2 bytes.
 * A pinned query version prevents routine imports from silently swapping the
 * image behind an immutable Dexie Cloud exercise ID.
 * Product owner confirmed the existing GIF library is theirs and approved its use.
 */
export function publicExerciseMediaUrl(
  row: MediaIdentity,
): string | null {
  const publicId = /^\d{4}$/.test(row.id) && row.sourceSha256 === PUBLIC_CATALOGUE_SHA
    ? row.id : row.sourceSha256 === 'coach-custom'
      && row.copiedFromScope === 'public'
      && typeof row.copiedFromExerciseId === 'string'
      && /^\d{4}$/.test(row.copiedFromExerciseId)
      && row.media_id === row.copiedFromExerciseId
      ? row.copiedFromExerciseId : null;
  if (!publicId || typeof row.gif_url !== 'string' || !row.gif_url.trim()) return null;
  return `/api/exercise-media/gym_keeper_apk/${publicId}?v=${approvedMediaRelease.datasetGitRevision}`;
}
