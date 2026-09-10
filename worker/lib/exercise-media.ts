const GYM_KEEPER_MEDIA_HOST = '47-1594.s.cdn13.com';
const GYM_KEEPER_MEDIA_PREFIX = '/img/gifs/180/';
const MAX_EXERCISE_MEDIA_BYTES = 8 * 1024 * 1024;
const BIRD_DOG_REFERENCE_KEY = '12411305-Bird-Dog-male_Back_180.gif';
const BIRD_DOG_GYMVISUAL_PREVIEW = 'https://gymvisual.com/img/p/2/0/8/2/4/20824.gif';
const IMPORT_REPOSITORY = 'buropotok/mezfit';

interface ExerciseMediaSourceRow {
  reference_source: string | null;
  reference_key: string | null;
  reference_media_url: string | null;
}

export function exerciseMediaPublicUrl(referenceSource: string | null, referenceKey: string | null): string | null {
  if (referenceSource !== 'gym_keeper_apk' || !referenceKey) return null;
  return `/api/exercise-media/gym_keeper_apk/${encodeURIComponent(referenceKey)}`;
}

export function exerciseMediaR2Key(referenceSource: string, referenceKey: string): string {
  const source = referenceSource.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `exercise-media/${source}/${referenceKey}`;
}

export function isApprovedGymKeeperMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === GYM_KEEPER_MEDIA_HOST
      && url.pathname.startsWith(GYM_KEEPER_MEDIA_PREFIX)
      && url.pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
}

function mediaHeaders(contentType: string, etag?: string): Headers {
  const headers = new Headers();
  headers.set('content-type', contentType);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  if (etag) headers.set('etag', etag);
  return headers;
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}

function validReferenceKey(referenceKey: string): boolean {
  return Boolean(referenceKey) && referenceKey.length <= 220 && !referenceKey.includes('/') && referenceKey.toLowerCase().endsWith('.gif');
}

async function isAuthorizedGithubImport(request: Request): Promise<boolean> {
  if (request.headers.get('x-github-repository') !== IMPORT_REPOSITORY) return false;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const response = await fetch(`https://api.github.com/repos/${IMPORT_REPOSITORY}/actions/runs?per_page=1`, {
    headers: {
      authorization,
      accept: 'application/vnd.github+json',
      'user-agent': 'MezfitExerciseMediaImporter/1.0',
      'x-github-api-version': '2022-11-28',
    },
  });
  return response.ok;
}

async function handleGithubImport(request: Request, db: D1Database, bucket: R2Bucket, referenceKey: string): Promise<Response> {
  if (!(await isAuthorizedGithubImport(request))) return new Response(null, { status: 403 });
  if (!validReferenceKey(referenceKey)) return notFound();

  const source = await db.prepare(`
    SELECT reference_source, reference_key, reference_media_url
    FROM exercise_definition
    WHERE reference_source = 'gym_keeper_apk' AND reference_key = ? AND is_archived = 0
    LIMIT 1
  `).bind(referenceKey).first<ExerciseMediaSourceRow>();
  if (!source?.reference_source || !source.reference_key) return notFound();

  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (declaredLength > MAX_EXERCISE_MEDIA_BYTES) return new Response(null, { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength < 6 || bytes.byteLength > MAX_EXERCISE_MEDIA_BYTES) return new Response(null, { status: 400 });
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return new Response(null, { status: 415 });

  await bucket.put(exerciseMediaR2Key(source.reference_source, source.reference_key), bytes, {
    httpMetadata: { contentType: 'image/gif', cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: {
      source: 'github_exercises_dataset',
      referenceKey: source.reference_key,
    },
  });
  return new Response(JSON.stringify({ ok: true, referenceKey: source.reference_key, bytes: bytes.byteLength }), {
    status: 201,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function handleExerciseMediaRoute(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
  referenceKey: string,
): Promise<Response> {
  if (request.method === 'POST') return handleGithubImport(request, db, bucket, referenceKey);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  }

  if (!validReferenceKey(referenceKey)) return notFound();

  const source = await db
    .prepare(`
      SELECT reference_source, reference_key, reference_media_url
      FROM exercise_definition
      WHERE reference_source = 'gym_keeper_apk'
        AND reference_key = ?
        AND is_archived = 0
      LIMIT 1
    `)
    .bind(referenceKey)
    .first<ExerciseMediaSourceRow>();

  if (!source?.reference_source || !source.reference_key || !source.reference_media_url) return notFound();
  if (!isApprovedGymKeeperMediaUrl(source.reference_media_url)) return notFound();

  const r2Key = exerciseMediaR2Key(source.reference_source, source.reference_key);
  const cached = await bucket.get(r2Key);
  if (cached) {
    const contentType = cached.httpMetadata?.contentType || 'image/gif';
    return new Response(request.method === 'HEAD' ? null : cached.body, {
      status: 200,
      headers: mediaHeaders(contentType, cached.httpEtag),
    });
  }

  const upstreamUrl = source.reference_key === BIRD_DOG_REFERENCE_KEY
    ? BIRD_DOG_GYMVISUAL_PREVIEW
    : source.reference_media_url;
  const upstream = await fetch(upstreamUrl, {
    redirect: 'follow',
    headers: {
      accept: 'image/gif,image/*;q=0.8,*/*;q=0.1',
      'user-agent': 'MezfitExerciseMedia/1.0',
    },
  });
  if (!upstream.ok) return notFound();

  const contentType = (upstream.headers.get('content-type') || 'image/gif').split(';', 1)[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) return notFound();

  const declaredLength = Number(upstream.headers.get('content-length') || '0');
  if (declaredLength > MAX_EXERCISE_MEDIA_BYTES) return new Response(null, { status: 413 });

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength < 6 || bytes.byteLength > MAX_EXERCISE_MEDIA_BYTES) return notFound();
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return notFound();

  await bucket.put(r2Key, bytes, {
    httpMetadata: {
      contentType: 'image/gif',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      source: source.reference_key === BIRD_DOG_REFERENCE_KEY ? 'gymvisual_watermarked_preview' : 'gym_keeper_apk',
      sourceUrl: upstreamUrl,
      referenceKey: source.reference_key,
    },
  });

  return new Response(request.method === 'HEAD' ? null : bytes, {
    status: 200,
    headers: mediaHeaders('image/gif'),
  });
}
