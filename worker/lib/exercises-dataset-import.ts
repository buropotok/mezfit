const IMPORT_REPOSITORY = 'buropotok/mezfit';
const SOURCE = 'github_exercises_dataset';
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

async function authorized(request: Request): Promise<boolean> {
  if (request.headers.get('x-github-repository') !== IMPORT_REPOSITORY) return false;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const response = await fetch(`https://api.github.com/repos/${IMPORT_REPOSITORY}/actions/runs?per_page=1`, {
    headers: { authorization, accept: 'application/vnd.github+json', 'user-agent': 'MezfitExerciseDatasetImporter/1.0', 'x-github-api-version': '2022-11-28' },
  });
  return response.ok;
}

function category(bodyPart: string): string {
  if (bodyPart === 'chest') return 'chest';
  if (bodyPart === 'back') return 'back';
  if (bodyPart === 'shoulders') return 'shoulders';
  if (bodyPart === 'upper arms' || bodyPart === 'lower arms') return 'arms';
  if (bodyPart === 'upper legs' || bodyPart === 'lower legs') return 'legs';
  if (bodyPart === 'waist') return 'core';
  if (bodyPart === 'cardio') return 'cardio';
  return 'other';
}

function equipmentCode(equipment: string): string {
  const v = equipment.toLowerCase();
  if (v === 'body weight' || v === 'assisted') return 'bodyweight';
  if (v.includes('barbell') || v.includes('ez barbell')) return 'barbell';
  if (v.includes('dumbbell')) return 'dumbbell_single';
  if (v.includes('cable')) return 'cable';
  if (v.includes('smith') || v.includes('lever') || v.includes('sled')) return 'machine';
  return 'other';
}

function trackingType(bodyPart: string): string {
  return bodyPart === 'cardio' ? 'time_distance' : 'weight_reps';
}

function r2Key(referenceKey: string): string {
  return `exercise-media/${SOURCE}/${referenceKey}`;
}

export async function handleDatasetExerciseImport(request: Request, db: D1Database): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!(await authorized(request))) return new Response(null, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const bodyPart = typeof body.body_part === 'string' ? body.body_part : '';
  const equipment = typeof body.equipment === 'string' ? body.equipment : '';
  const target = typeof body.target === 'string' ? body.target : '';
  const gifUrl = typeof body.gif_url === 'string' ? body.gif_url : '';
  const instruction = body.instructions && typeof body.instructions === 'object' ? (body.instructions as Record<string, unknown>).ru : null;
  if (!/^\d{4}$/.test(id) || !name || !bodyPart || !equipment || !/^videos\/.+\.gif$/i.test(gifUrl)) return new Response(null, { status: 400 });

  const existing = await db.prepare(`SELECT id FROM exercise_definition WHERE reference_source = ? AND reference_key = ? LIMIT 1`).bind(SOURCE, id).first<{id:number}>();
  const byName = existing ? null : await db.prepare(`SELECT id FROM exercise_definition WHERE scope = 'global' AND lower(name) = lower(?) LIMIT 1`).bind(name).first<{id:number}>();
  const description = typeof instruction === 'string' ? instruction : null;
  const values = [name, description, trackingType(bodyPart), target || bodyPart, equipment, category(bodyPart), equipmentCode(equipment), SOURCE, id, gifUrl, Number(id)];
  if (existing || byName) {
    const rowId = existing?.id ?? byName!.id;
    await db.prepare(`UPDATE exercise_definition SET name=?, description=?, tracking_type=?, primary_muscle=?, equipment=?, category_code=?, equipment_code=?, reference_source=?, reference_key=?, reference_media_url=?, reference_order=?, is_archived=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...values, rowId).run();
  } else {
    await db.prepare(`INSERT INTO exercise_definition (scope,name,description,tracking_type,primary_muscle,equipment,category_code,equipment_code,reference_source,reference_key,reference_media_url,reference_order) VALUES ('global',?,?,?,?,?,?,?,?,?,?,?)`).bind(...values).run();
  }
  return Response.json({ ok: true, id });
}

export async function handleDatasetMedia(request: Request, db: D1Database, bucket: R2Bucket, referenceKey: string): Promise<Response> {
  if (!/^\d{4}\.gif$/i.test(referenceKey)) return new Response(null, { status: 404 });
  const datasetId = referenceKey.slice(0, 4);
  const exists = await db.prepare(`SELECT 1 AS ok FROM exercise_definition WHERE reference_source=? AND reference_key=? AND is_archived=0 LIMIT 1`).bind(SOURCE, datasetId).first<{ok:number}>();
  if (!exists) return new Response(null, { status: 404 });
  const key = r2Key(referenceKey);
  if (request.method === 'POST') {
    if (!(await authorized(request))) return new Response(null, { status: 403 });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength < 6 || bytes.byteLength > MAX_MEDIA_BYTES) return new Response(null, { status: 400 });
    const sig = new TextDecoder('ascii').decode(bytes.slice(0, 6));
    if (sig !== 'GIF87a' && sig !== 'GIF89a') return new Response(null, { status: 415 });
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/gif', cacheControl: 'public, max-age=31536000, immutable' }, customMetadata: { source: SOURCE, datasetId } });
    return Response.json({ ok: true, datasetId }, { status: 201 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  const object = await bucket.get(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers({ 'content-type': object.httpMetadata?.contentType || 'image/gif', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}
