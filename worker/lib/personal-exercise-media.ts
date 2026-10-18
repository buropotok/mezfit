import { validateTelegramInitData } from './telegram';

const MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^[a-f0-9]{64}$/;
const TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

type PersonalMediaEnvironment = {
  TELEGRAM_BOT_TOKEN: string;
  R2_BINDING_MEZFIT: R2Bucket;
};

function imageSignature(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/gif') {
    return bytes.length >= 6 && (new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF89a'
      || new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF87a');
  }
  if (type === 'image/jpeg') return bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length >= 8
    && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  return type === 'image/webp' && bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
}

function key(id: string, version: string): string {
  return `personal-exercise-media/${id}/${version}`;
}

export async function handlePersonalExerciseMedia(
  request: Request, env: PersonalMediaEnvironment, id?: string,
): Promise<Response> {
  if (request.method === 'POST' && id === undefined) {
    // Image uploads are privileged; a public media URL never grants permission to upload.
    await validateTelegramInitData(
      request.headers.get('x-telegram-init-data') ?? '', env.TELEGRAM_BOT_TOKEN,
    );
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!TYPES.has(type) || Number(request.headers.get('content-length') || 0) > MAX_BYTES) {
      return Response.json({ error: 'INVALID_EXERCISE_IMAGE' }, { status: 400 });
    }
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength < 12 || buffer.byteLength > MAX_BYTES
      || !imageSignature(new Uint8Array(buffer), type)) {
      return Response.json({ error: 'INVALID_EXERCISE_IMAGE' }, { status: 400 });
    }
    const version = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    const mediaId = crypto.randomUUID();
    await env.R2_BINDING_MEZFIT.put(key(mediaId, version), buffer, {
      httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
    });
    return Response.json({
      url: `/api/exercise-media/personal/${mediaId}?v=${version}`,
    }, { status: 201, headers: { 'cache-control': 'no-store' } });
  }
  if (id && (request.method === 'GET' || request.method === 'HEAD')) {
    const version = new URL(request.url).searchParams.get('v') ?? '';
    if (!MEDIA_ID.test(id) || !VERSION.test(version)) return new Response(null, { status: 404 });
    // The unguessable versioned URL is a shareable media reference. Clients can
    // render snapshots assigned by a coach without a privileged cloud read.
    const object = await env.R2_BINDING_MEZFIT.get(key(id, version));
    if (!object) return new Response(null, { status: 404 });
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        etag: object.httpEtag,
      },
    });
  }
  return new Response(null, { status: 405, headers: { allow: id ? 'GET, HEAD' : 'POST' } });
}
