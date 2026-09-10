import { exerciseMediaR2Key } from './exercise-media';

const GYMVISUAL_HOST = 'gymvisual.com';
const GYMVISUAL_IMAGE_PREFIX = '/img/p/';
const MAX_GIF_BYTES = 8 * 1024 * 1024;

export const BIRD_DOG_REFERENCE_KEY = '12411305-Bird-Dog-male_Back_180.gif';
export const BIRD_DOG_GYMVISUAL_PREVIEW = 'https://gymvisual.com/img/p/2/0/8/2/4/20824.gif';

function isApprovedGymVisualPreview(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === GYMVISUAL_HOST
      && url.pathname.startsWith(GYMVISUAL_IMAGE_PREFIX)
      && url.pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
}

export async function importGymVisualPreviewToR2(
  bucket: R2Bucket,
  referenceKey = BIRD_DOG_REFERENCE_KEY,
  previewUrl = BIRD_DOG_GYMVISUAL_PREVIEW,
): Promise<{ r2Key: string; bytes: number; sourceUrl: string }> {
  if (!isApprovedGymVisualPreview(previewUrl)) throw new Error('Unapproved GymVisual preview URL');
  if (!referenceKey || referenceKey.includes('/') || !referenceKey.toLowerCase().endsWith('.gif')) {
    throw new Error('Invalid exercise reference key');
  }

  const response = await fetch(previewUrl, {
    redirect: 'follow',
    headers: {
      accept: 'image/gif,image/*;q=0.8,*/*;q=0.1',
      'user-agent': 'MezfitExerciseMediaImporter/1.0',
    },
  });
  if (!response.ok) throw new Error(`GymVisual returned HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length') || '0');
  if (declaredLength > MAX_GIF_BYTES) throw new Error('GymVisual preview exceeds size limit');

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 6 || bytes.byteLength > MAX_GIF_BYTES) throw new Error('Invalid GymVisual preview size');

  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') throw new Error('GymVisual response is not a GIF');

  const r2Key = exerciseMediaR2Key('gym_keeper_apk', referenceKey);
  await bucket.put(r2Key, bytes, {
    httpMetadata: {
      contentType: 'image/gif',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      source: 'gymvisual_watermarked_preview',
      sourceUrl: previewUrl,
      referenceKey,
    },
  });

  return { r2Key, bytes: bytes.byteLength, sourceUrl: previewUrl };
}
