import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseReadOnlyCredentials } from './diagnose-public-catalogue-rest.mjs';

const DB_URL = 'https://zjv60oxag.dexie.cloud';
const REALM = 'rlm-public';
const EXERCISES = 'publicFitnessProgramerExercises';
const GIFS = 'publicFitnessProgramerGifs';
const CATALOGUES = 'publicFitnessProgramerCatalogues';
export const SCHEMA = Object.freeze({ [EXERCISES]: 'id', [GIFS]: 'id', [CATALOGUES]: 'id' });
const SOURCE_TREES = Object.freeze({
  'assets/work': '1216807c9f9b0fe2cce95e6a88dcd77e9bc74244',
  'assets/media': '078fb340e103355aee8ff5596608e63a017e762b',
});
const METRICS = new Set(['weight_reps', 'time', 'time_distance', 'time_reps', 'time_weight']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const load = async path => JSON.parse(await readFile(path, 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const fail = code => { throw new Error(code); };

export function authorize(env) {
  if (env.GITHUB_REPOSITORY !== 'buropotok/mezfit'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || !env.GITHUB_ACTOR || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER)
    fail('UNAUTHORIZED_FITNESSPROGRAMER_DISPATCH');
  if (['preview', 'apply'].includes(env.BASE_2_OPERATION)) return;
  fail('INVALID_FITNESSPROGRAMER_OPERATION');
}

export function schemaPlan(manifest, beforeSchema, beforeRoles) {
  if (!isDeepStrictEqual(manifest, { schema: SCHEMA })
    || !record(beforeSchema?.schema) || !record(beforeRoles?.roles))
    fail('INVALID_FITNESSPROGRAMER_SCHEMA');
  const missing = {};
  for (const [table, key] of Object.entries(SCHEMA)) {
    const current = beforeSchema.schema[table];
    if (current === undefined) missing[table] = key;
    else if (current !== key) fail('CONFLICTING_FITNESSPROGRAMER_TABLE');
  }
  return { schema: missing };
}

function validateAsset(path, bytes, objectId) {
  if (!['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
    || bytes.length < 16 || bytes.length > 2 * 1024 * 1024)
    fail('INVALID_FITNESSPROGRAMER_GIF');
  const gitDigest = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (gitDigest !== objectId) fail('FITNESSPROGRAMER_GIF_CHECKOUT_MISMATCH');
  return { path, digest: hash(bytes), size: bytes.length };
}

function treeFiles(directory) {
  const tree = git('ls-tree', '-r', '-z', 'HEAD', directory);
  return new Map(tree.split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t');
    const [mode, type, oid] = entry.slice(0, tab).split(' ');
    if (mode !== '100644' || type !== 'blob') fail('UNEXPECTED_FITNESSPROGRAMER_TREE_ENTRY');
    return [entry.slice(tab + 1), oid];
  }));
}

async function prepareRelease() {
  for (const [directory, tree] of Object.entries(SOURCE_TREES)) {
    if (git('rev-parse', 'HEAD:' + directory) !== tree) fail('UNAPPROVED_FITNESSPROGRAMER_TREE');
    if (git('status', '--porcelain', '--', directory)) fail('DIRTY_FITNESSPROGRAMER_SOURCE');
  }
  const exercises = new Map();
  const files = treeFiles('assets/work');
  const gifFiles = treeFiles('assets/media');
  const gifPaths = new Set();
  for (const path of files.keys()) {
    const category = /^assets\/work\/([a-z-]+)\/[^/]+\.json$/.exec(path)?.[1];
    if (!category) fail('INVALID_FITNESSPROGRAMER_EXERCISE_PATH');
    const card = await load(path);
    const slug = /^https:\/\/fitnessprogramer\.com\/exercise\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(card.source_url)?.[1];
    if (!slug || typeof card.name_ru !== 'string' || !card.name_ru.trim()
      || typeof card.name !== 'string' || !METRICS.has(card.tracking_type))
      fail('INVALID_FITNESSPROGRAMER_CARD');
    const id = 'fitnessprogramer:' + slug;
    const gifPath = card.image_id ? 'assets/media/' + card.image_id : null;
    if (gifPath && !gifFiles.has(gifPath)) fail('MISSING_FITNESSPROGRAMER_GIF');
    if (gifPath) gifPaths.add(gifPath);
    const prior = exercises.get(id);
    if (prior && !isDeepStrictEqual(prior.card, card)) fail('CONFLICTING_FITNESSPROGRAMER_CARD');
    if (prior) {
      prior.categories.add(category);
    } else {
      exercises.set(id, { id, card, categories: new Set([category]), gifPath });
    }
  }
  if (files.size !== 1673 || exercises.size !== 1173 || gifPaths.size !== 1168
    || gifFiles.size !== gifPaths.size) fail('INCOMPLETE_FITNESSPROGRAMER_SOURCE');
  const assets = [];
  for (const path of [...gifPaths].sort()) {
    assets.push(validateAsset(path, await readFile(path), gifFiles.get(path)));
  }
  const gifByPath = new Map(assets.map(asset => [asset.path, asset]));
  const release = hash(JSON.stringify(SOURCE_TREES));
  const publicRow = id => ({ id, realmId: REALM, owner: null, release });
  const rows = [...exercises.values()].map(({ id, card, categories, gifPath }) => ({
    ...publicRow(id), card, categories: [...categories].sort(),
    gifId: gifPath ? 'fitnessprogramer:gif:' + gifByPath.get(gifPath).digest : null,
  }));
  const uniqueBlobs = new Map();
  for (const asset of assets) uniqueBlobs.set(asset.digest, asset);
  if (uniqueBlobs.size !== 1167) fail('UNEXPECTED_FITNESSPROGRAMER_GIF_DIGEST_COUNT');
  return {
    rows, assets: uniqueBlobs, bytes: assets.reduce((total, asset) => total + asset.size, 0),
    manifest: { ...publicRow('fitnessprogramer:v1'), exerciseCount: rows.length, gifCount: uniqueBlobs.size },
    gifRow: (asset, ref) => ({
      ...publicRow('fitnessprogramer:gif:' + asset.digest), digest: asset.digest, size: asset.size,
      image: { _bt: 'Blob', ref, size: asset.size, ct: 'image/gif' }, _hasBlobRefs: 1,
    }),
  };
}

export function missingRows(actual, expected, code) {
  const byId = new Map(expected.map(row => [row.id, row]));
  const seen = new Set();
  for (const row of actual) {
    const wanted = byId.get(row?.id);
    if (!wanted || seen.has(row.id)
      || !Object.entries(wanted).every(([key, value]) => isDeepStrictEqual(value, row[key]))) fail(code);
    seen.add(row.id);
  }
  return expected.filter(row => !seen.has(row.id));
}

// Settle outstanding requests after a failure and leave the remaining work for rerun.
async function processBatchQueue(items, processItem) {
  let next = 0;
  let stopped = false;
  const outcomes = await Promise.allSettled(Array.from({ length: 3 }, async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      try {
        await processItem(item);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }));
  const failure = outcomes.find(outcome => outcome.status === 'rejected');
  if (failure) throw failure.reason;
}

const REQUEST_SPACING_MS = 350;
const MAX_RETRIES = 8;
const MAX_RETRY_WAIT_MS = 15 * 60_000;
const ROW_BATCH_SIZE = 25;

function retryAfterMs(header, now) {
  if (!header) return 0;
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

/** One rate limit and cooldown shared by the entire publishing job. */
export function createDexieRequestQueue({
  fetchRequest = fetch, wait = sleep, clock = Date.now, onThrottle = () => {},
} = {}) {
  let nextRequestAt = 0;
  return async (url, init = {}, operation = 'REQUEST') => {
    for (let attempt = 0; ; attempt++) {
      let delay = nextRequestAt - clock();
      while (delay > 0) {
        await wait(delay);
        delay = nextRequestAt - clock();
      }
      nextRequestAt = clock() + REQUEST_SPACING_MS;
      const response = await fetchRequest(url, { ...init, signal: AbortSignal.timeout(60000) });
      if (response.status !== 429) return response;

      const advertisedDelay = retryAfterMs(response.headers.get('retry-after'), clock());
      const backoff = Math.min(300_000, 5000 * (2 ** attempt));
      const waitMs = Math.max(advertisedDelay, backoff);
      const canRetry = attempt < MAX_RETRIES && waitMs <= MAX_RETRY_WAIT_MS;
      if (canRetry) nextRequestAt = Math.max(nextRequestAt, clock() + waitMs);
      await response.body?.cancel();
      if (!canRetry) fail('FITNESSPROGRAMER_' + operation + '_RATE_LIMIT_EXHAUSTED');
      onThrottle({ operation, retry: attempt + 1, waitMs });
    }
  };
}

async function publish(prepared, mode) {
  const { clientId, clientSecret } = parseReadOnlyCredentials(process.env.DEXIE_CLOUD_WRITE_KEY, DB_URL);
  const scopes = ['ACCESS_DB', 'GLOBAL_READ'];
  if (mode === 'apply') scopes.push('GLOBAL_WRITE');
  const queuedFetch = createDexieRequestQueue({
    onThrottle: detail => console.log(JSON.stringify({ status: 'rate_limited', ...detail })),
  });
  const issueToken = async () => {
    const token = await queuedFetch(DB_URL + '/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', scopes, client_id: clientId, client_secret: clientSecret }),
    }, 'TOKEN');
    if (!token.ok) fail('FITNESSPROGRAMER_TOKEN_REQUEST_FAILED');
    const payload = await token.json();
    if (typeof payload?.accessToken !== 'string' || !payload.accessToken)
      fail('INVALID_FITNESSPROGRAMER_TOKEN');
    return payload.accessToken;
  };
  let accessToken = await issueToken();
  let renewingToken;
  const request = async (operation, path, { method = 'GET', body, type } = {}) => {
    if (mode === 'preview' && method !== 'GET') fail('FITNESSPROGRAMER_PREVIEW_CANNOT_WRITE');
    const send = token => {
      const headers = { authorization: 'Bearer ' + token };
      if (type) headers['content-type'] = type;
      return queuedFetch(DB_URL + path, { method, headers, body }, operation);
    };
    const sentToken = accessToken;
    let response = await send(sentToken);
    if (response.status === 401) {
      await response.body?.cancel();
      if (accessToken === sentToken) {
        renewingToken ??= issueToken().then(token => { accessToken = token; })
          .finally(() => { renewingToken = undefined; });
        await renewingToken;
      }
      response = await send(accessToken);
    }
    if (!response.ok) fail('FITNESSPROGRAMER_' + operation + '_HTTP_' + response.status);
    return response;
  };
  const readRows = async table => {
    const value = await (await request('LIST_ROWS', '/all/' + table)).json();
    const rows = Array.isArray(value) ? value : value?.data;
    if (!Array.isArray(rows)) fail('INVALID_FITNESSPROGRAMER_READBACK');
    return rows;
  };
  const writeRows = async (table, rows) => {
    for (let i = 0; i < rows.length; i += ROW_BATCH_SIZE) {
      await request('WRITE_ROWS', '/all/' + table, { method: 'POST', body: JSON.stringify(rows.slice(i, i + ROW_BATCH_SIZE)),
        type: 'application/json' });
    }
  };
  const refPattern = /^[0-9]+:[A-Za-z0-9_-]{6,}$/;
  const plan = async () => {
    const [rows, gifs, catalogues] = await Promise.all([readRows(EXERCISES), readRows(GIFS), readRows(CATALOGUES)]);
    const pendingRows = missingRows(rows, prepared.rows, 'CONFLICTING_FITNESSPROGRAMER_EXERCISE');
    const pendingCatalogue = missingRows(catalogues, [prepared.manifest], 'CONFLICTING_FITNESSPROGRAMER_CATALOGUE');
    const pendingGifs = new Map(prepared.assets);
    for (const row of gifs) {
      const asset = pendingGifs.get(row?.digest);
      const ref = row?.image?.ref;
      if (!asset || typeof ref !== 'string' || !refPattern.test(ref))
        fail('UNEXPECTED_FITNESSPROGRAMER_MEDIA_ROW');
      missingRows([row], [prepared.gifRow(asset, ref)], 'CONFLICTING_FITNESSPROGRAMER_MEDIA_ROW');
      pendingGifs.delete(row.digest);
    }
    if (!pendingCatalogue.length && (pendingRows.length || pendingGifs.size))
      fail('INCOMPLETE_ACTIVE_FITNESSPROGRAMER_RELEASE');
    return { pendingRows, pendingGifs, pendingCatalogue, gifs };
  };
  const first = await plan();
  console.log(JSON.stringify({ mode, exercisesPending: first.pendingRows.length, gifsPending: first.pendingGifs.size }));
  if (mode === 'preview') return;

  const pendingGifs = [...first.pendingGifs.values()];
  for (let offset = 0; offset < pendingGifs.length; offset += ROW_BATCH_SIZE) {
    const rows = [];
    try {
      await processBatchQueue(pendingGifs.slice(offset, offset + ROW_BATCH_SIZE), async asset => {
        const bytes = await readFile(asset.path);
        if (hash(bytes) !== asset.digest) fail('FITNESSPROGRAMER_GIF_CHANGED_DURING_PUBLICATION');
        const uploaded = await (await request('UPLOAD_GIF', '/blob/' + asset.digest + '?ct=image%2Fgif',
          { method: 'PUT', body: bytes, type: 'image/gif' })).json();
        if (typeof uploaded?.ref !== 'string' || !refPattern.test(uploaded.ref))
          fail('INVALID_FITNESSPROGRAMER_BLOB_REF');
        rows.push(prepared.gifRow(asset, uploaded.ref));
      });
    } finally {
      // Preserve successful uploads even when another GIF in the batch fails.
      await writeRows(GIFS, rows);
    }
    console.log(JSON.stringify({
      status: 'gifs_staged', gifsPending: pendingGifs.length - offset - rows.length,
    }));
  }
  await writeRows(EXERCISES, first.pendingRows);
  const staged = await plan();
  if (staged.pendingRows.length || staged.pendingGifs.size) fail('FITNESSPROGRAMER_STAGE_INCOMPLETE');
  await processBatchQueue(staged.gifs, async row => {
    const bytes = await (await request('VERIFY_GIF', '/blob/' + encodeURIComponent(row.image.ref))).arrayBuffer();
    if (bytes.byteLength !== row.size || hash(Buffer.from(bytes)) !== row.digest)
      fail('FITNESSPROGRAMER_BLOB_READBACK_MISMATCH');
  });
  await writeRows(CATALOGUES, staged.pendingCatalogue);
  if ((await plan()).pendingCatalogue.length) fail('FITNESSPROGRAMER_MANIFEST_NOT_ACTIVE');
  console.log(JSON.stringify({ status: 'verified', exercises: prepared.rows.length, gifs: staged.gifs.length }));
}

async function main() {
  const action = process.argv[2];
  if (action === 'validate-source') {
    const prepared = await prepareRelease();
    console.log(JSON.stringify({ exercises: prepared.rows.length, gifFiles: 1168,
      distinctBlobs: prepared.assets.size, bytes: prepared.bytes }));
    return;
  }
  const env = process.env;
  authorize(env);
  if (action === 'preflight') return;
  if ((await load('dexie-cloud.json')).dbUrl !== DB_URL) fail('UNEXPECTED_DATABASE_URL');
  if (action === 'publish') {
    await publish(await prepareRelease(), env.BASE_2_OPERATION);
    return;
  }
  if (!env.RUNNER_TEMP || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')
    || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) fail('GITHUB_RUNNER_REQUIRED');
  const dir = join(env.RUNNER_TEMP, 'dexie-schema-' + env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT);
  const manifest = await load('cloud/schema-fitnessprogramer.json');
  const beforeSchema = await load(join(dir, 'before-schema.json'));
  const beforeRoles = await load(join(dir, 'before-roles.json'));
  const pending = schemaPlan(manifest, beforeSchema, beforeRoles);
  if (action === 'plan') {
    const missingCount = Object.keys(pending.schema).length;
    await writeFile(join(dir, 'fitnessprogramer-import.json'), JSON.stringify(pending), { flag: 'wx', mode: 0o600 });
    await appendFile(env.GITHUB_OUTPUT, 'missing_count=' + missingCount + '\n');
    console.log(JSON.stringify({ tablesPending: missingCount }));
  } else if (action === 'recheck' && env.BASE_2_OPERATION === 'apply') {
    if (!isDeepStrictEqual(beforeSchema, await load(join(dir, 'current-schema.json')))
      || !isDeepStrictEqual(beforeRoles, await load(join(dir, 'current-roles.json')))
      || !isDeepStrictEqual(pending, await load(join(dir, 'fitnessprogramer-import.json'))))
      fail('FITNESSPROGRAMER_CONFIGURATION_CHANGED');
  } else if (action === 'verify' && env.BASE_2_OPERATION === 'apply') {
    const expected = { ...beforeSchema, schema: { ...beforeSchema.schema, ...SCHEMA } };
    if (!isDeepStrictEqual(expected, await load(join(dir, 'after-schema.json')))
      || !isDeepStrictEqual(beforeRoles, await load(join(dir, 'after-roles.json'))))
      fail('FITNESSPROGRAMER_CONFIGURATION_READBACK_MISMATCH');
  } else fail('INVALID_FITNESSPROGRAMER_OPERATION');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'FITNESSPROGRAMER_OPERATOR_FAILED');
    process.exitCode = 1;
  });
}
