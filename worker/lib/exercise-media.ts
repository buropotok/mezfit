const MAX_EXERCISE_MEDIA_BYTES = 8 * 1024 * 1024;
const IMPORT_REPOSITORY = 'buropotok/mezfit';
const DATASET_SOURCE = 'github_exercises_dataset';

interface ExerciseMediaSourceRow { reference_source: string | null; reference_key: string | null; reference_media_url: string | null; }

export function exerciseMediaPublicUrl(referenceSource: string | null, referenceKey: string | null): string | null {
  if (!referenceSource || !referenceKey) return null;
  if (referenceSource !== 'gym_keeper_apk' && referenceSource !== DATASET_SOURCE) return null;
  return `/api/exercise-media/${encodeURIComponent(referenceSource)}/${encodeURIComponent(referenceKey)}`;
}

export function exerciseMediaR2Key(referenceSource: string, referenceKey: string): string {
  const source = referenceSource.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `exercise-media/${source}/${referenceKey}`;
}

function mediaHeaders(contentType: string, etag?: string): Headers { const h=new Headers();h.set('content-type',contentType);h.set('cache-control','public, max-age=31536000, immutable');h.set('x-content-type-options','nosniff');if(etag)h.set('etag',etag);return h; }
function notFound(): Response { return new Response(null,{status:404,headers:{'cache-control':'no-store'}}); }
function validReferenceKey(k:string):boolean{return Boolean(k)&&k.length<=220&&!k.includes('/')&&k.toLowerCase().endsWith('.gif');}
async function isAuthorizedGithubImport(request:Request):Promise<boolean>{if(request.headers.get('x-github-repository')!==IMPORT_REPOSITORY)return false;const a=request.headers.get('authorization')||'';if(!a.startsWith('Bearer '))return false;const r=await fetch(`https://api.github.com/repos/${IMPORT_REPOSITORY}/actions/runs?per_page=1`,{headers:{authorization:a,accept:'application/vnd.github+json','user-agent':'MezfitExerciseMediaImporter/1.0','x-github-api-version':'2022-11-28'}});return r.ok;}
function categoryCode(v:string):string{const s=v.toLowerCase();if(s.includes('chest'))return'chest';if(/arm|bicep|tricep|forearm/.test(s))return'arms';if(/back|lat/.test(s))return'back';if(/leg|thigh|calf|glute|hip/.test(s))return'legs';if(/shoulder|delt/.test(s))return'shoulders';if(/waist|abs|core/.test(s))return'core';if(/cardio/.test(s))return'cardio';return'other';}
function equipmentCode(v:string):string{const s=v.toLowerCase();if(/body weight|bodyweight|none/.test(s))return'bodyweight';if(s.includes('barbell'))return'barbell';if(s.includes('dumbbell'))return'dumbbell_single';if(/cable|pulley/.test(s))return'cable';if(/machine|lever|smith|sled/.test(s))return'machine';return'other';}
function trackingType(body:string):string{return /cardio/.test(body.toLowerCase())?'time_distance':'weight_reps';}

async function handleGithubImport(request:Request,db:D1Database,bucket:R2Bucket,source:string,referenceKey:string):Promise<Response>{
  if(!(await isAuthorizedGithubImport(request)))return new Response(null,{status:403});
  if(!validReferenceKey(referenceKey))return notFound();
  const bytes=await request.arrayBuffer();if(bytes.byteLength<6||bytes.byteLength>MAX_EXERCISE_MEDIA_BYTES)return new Response(null,{status:400});
  const sig=new TextDecoder('ascii').decode(bytes.slice(0,6));if(sig!=='GIF87a'&&sig!=='GIF89a')return new Response(null,{status:415});
  if(source===DATASET_SOURCE){
    let meta:any;try{meta=JSON.parse(decodeURIComponent(request.headers.get('x-exercise-metadata')||''));}catch{return new Response('invalid metadata',{status:400});}
    if(!meta?.id||!meta?.name||!meta?.gif_url)return new Response('missing metadata',{status:400});
    const existing=await db.prepare('SELECT id FROM exercise_definition WHERE reference_source=? AND reference_key=? LIMIT 1').bind(DATASET_SOURCE,String(meta.id)).first<{id:number}>();
    if(existing){await db.prepare(`UPDATE exercise_definition SET name=?,primary_muscle=?,equipment=?,description=?,category_code=?,equipment_code=?,reference_media_url=?,reference_order=?,source_metadata_json=?,is_archived=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(meta.name),String(meta.body_part||meta.muscle_group||''),String(meta.equipment||''),String(meta.instructions?.ru||meta.instructions?.en||meta.description||'')||null,categoryCode(String(meta.body_part||meta.category||meta.muscle_group||'')),equipmentCode(String(meta.equipment||'')),String(meta.gif_url),Number(meta.id)||null,JSON.stringify(meta),existing.id).run();}
    else{await db.prepare(`INSERT INTO exercise_definition(scope,name,tracking_type,primary_muscle,equipment,description,category_code,equipment_code,reference_source,reference_key,reference_media_url,reference_order,source_metadata_json) VALUES('global',?,?,?,?,?,?,?,?,?,?,?,?)`).bind(String(meta.name),trackingType(String(meta.body_part||meta.category||'')),String(meta.body_part||meta.muscle_group||''),String(meta.equipment||''),String(meta.instructions?.ru||meta.instructions?.en||meta.description||'')||null,categoryCode(String(meta.body_part||meta.category||meta.muscle_group||'')),equipmentCode(String(meta.equipment||'')),DATASET_SOURCE,String(meta.id),String(meta.gif_url),Number(meta.id)||null,JSON.stringify(meta)).run();}
  } else if(source==='gym_keeper_apk'){
    const row=await db.prepare(`SELECT reference_key FROM exercise_definition WHERE reference_source='gym_keeper_apk' AND reference_key=? AND is_archived=0 LIMIT 1`).bind(referenceKey).first();if(!row)return notFound();
  } else return notFound();
  await bucket.put(exerciseMediaR2Key(source,referenceKey),bytes,{httpMetadata:{contentType:'image/gif',cacheControl:'public, max-age=31536000, immutable'},customMetadata:{source,referenceKey}});
  return new Response(JSON.stringify({ok:true,referenceKey,bytes:bytes.byteLength}),{status:201,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}

export async function handleExerciseMediaRoute(request:Request,db:D1Database,bucket:R2Bucket,source:string,referenceKey:string):Promise<Response>{
  if(request.method==='POST')return handleGithubImport(request,db,bucket,source,referenceKey);
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{allow:'GET, HEAD, POST'}});
  if(!validReferenceKey(referenceKey))return notFound();
  const row=await db.prepare(`SELECT reference_source,reference_key,reference_media_url FROM exercise_definition WHERE reference_source=? AND reference_key=? AND is_archived=0 LIMIT 1`).bind(source,referenceKey).first<ExerciseMediaSourceRow>();
  if(!row?.reference_source||!row.reference_key)return notFound();
  const cached=await bucket.get(exerciseMediaR2Key(source,referenceKey));if(!cached)return notFound();
  return new Response(request.method==='HEAD'?null:cached.body,{status:200,headers:mediaHeaders(cached.httpMetadata?.contentType||'image/gif',cached.httpEtag)});
}
