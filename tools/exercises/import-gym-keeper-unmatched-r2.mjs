#!/usr/bin/env node
/**
 * Manual, media-only import of the 112 Gym Keeper exercise GIF references that
 * are absent by ID from the pinned 1324-record Mezfit catalogue.
 *
 * Never changes Dexie Cloud, D1, canonical media indexes or existing R2 keys.
 * Downloads only the exact original APK GIF URL (not gymvisual.com).
 * Legacy R2 objects may have come from approximate name matching and are not
 * authoritative source bytes for this isolated import.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'buropotok/mezfit';
const STAGING = 'audit/visual/input/gymkeeper_unmatched_112_gymvisual_metadata.json';
const AUDIT = 'audit/visual/audit_execution_plan.json';
const BUCKET = 'mezfit';
export const DESTINATION_PREFIX = 'exercise-media/gym_keeper_apk/unmatched-112/v1/';
const CDN_BASE = 'https://47-1594.s.cdn13.com/img/gifs/180/';
const MAX_BYTES = 8 * 1024 * 1024;
const REQUIRED_ROWS = 112;
const REQUIRED_CATALOGUE_IDS = 1324;
const SOURCE_SHA256 = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const WRANGLER = './node_modules/.bin/wrangler';

function fail(message) { throw new Error(message); }
function sha(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function validKey(key) {
  return typeof key === 'string'
    && /^\d{4}1305-[A-Za-z0-9_.()+-]+_180\.gif$/.test(key)
    && key.length <= 220;
}
export function validateGifBytes(bytes, label) {
  if (bytes.length < 10 || bytes.length > MAX_BYTES) fail('Invalid GIF size for ' + label);
  const signature = bytes.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF87a' && signature !== 'GIF89a') fail('Not GIF bytes: ' + label);
  if (bytes.readUInt16LE(6) !== 180 || bytes.readUInt16LE(8) !== 180) {
    fail('Expected 180x180 GIF for ' + label);
  }
}

export function buildPlan(staging, audit, sqlSources) {
  if (!staging || staging.schema_version !== '0.1.0-staging'
      || !Array.isArray(staging.records) || staging.records.length !== REQUIRED_ROWS
      || !audit || !Array.isArray(audit.stages) || !Array.isArray(sqlSources)
      || sqlSources.length !== 7) fail('Unexpected import inputs');

  if (audit.source?.catalogue_sha256 !== SOURCE_SHA256 || audit.total_exercises !== REQUIRED_CATALOGUE_IDS) {
    fail('Unapproved public catalogue SHA-256 baseline');
  }
  const catalogueIds = audit.stages.flatMap(s => s.exercise_ids || []);
  if (catalogueIds.length !== REQUIRED_CATALOGUE_IDS
      || new Set(catalogueIds).size !== REQUIRED_CATALOGUE_IDS
      || catalogueIds.some(id => !/^\d{4}$/.test(id))) {
    fail('Catalogue ID baseline is not the pinned 1324-record release');
  }
  const existing = new Set(catalogueIds);
  const apk = new Map();
  for (const sql of sqlSources) {
    for (const match of sql.matchAll(/'gym_keeper_apk',\s*'([^']+\.gif)'/g)) {
      const key = match[1];
      if (!validKey(key)) fail('Unsafe APK GIF key');
      const id = key.slice(0, 4);
      if (apk.has(id)) fail('Duplicate APK exercise ID: ' + id);
      apk.set(id, key);
    }
  }
  const missing = [...apk.keys()].filter(id => !existing.has(id));
  if (missing.length !== REQUIRED_ROWS) fail('Expected exactly 112 APK IDs absent from Mezfit');

  const rows = new Map();
  for (const row of staging.records) {
    if (!row || typeof row.id !== 'string' || !/^\d{4}$/.test(row.id)
        || existing.has(row.id) || rows.has(row.id)
        || row.gymvisual_reference_candidate !== row.id + '13'
        || !validKey(row.gym_keeper_apk_reference_key)
        || row.gym_keeper_apk_reference_key.slice(0, 4) !== row.id
        || apk.get(row.id) !== row.gym_keeper_apk_reference_key) {
      fail('Untrusted or inconsistent staging row: ' + String(row?.id));
    }
    rows.set(row.id, {
      id: row.id,
      key: row.gym_keeper_apk_reference_key,
      sourceCdn: CDN_BASE + encodeURIComponent(row.gym_keeper_apk_reference_key),
      targetR2: DESTINATION_PREFIX + row.gym_keeper_apk_reference_key,
    });
  }
  if (rows.size !== missing.length || missing.some(id => !rows.has(id))) {
    fail('Staging does not match all APK IDs absent from canonical catalogue');
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadPlan() {
  const [staging, audit, ...sql] = await Promise.all([
    readFile(STAGING, 'utf8').then(JSON.parse),
    readFile(AUDIT, 'utf8').then(JSON.parse),
    ...Array.from({ length: 7 }, (_, i) => {
      const n = String(i + 7).padStart(4, '0');
      const part = String(i + 1).padStart(2, '0');
      return readFile('migrations/' + n + '_gym_keeper_exercise_seed_' + part + '.sql', 'utf8');
    }),
  ]);
  return buildPlan(staging, audit, sql);
}

async function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(WRANGLER, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', data => { output = (output + data.toString()).slice(-8192); });
    process.stderr.on('data', data => { output = (output + data.toString()).slice(-8192); });
    process.once('error', reject);
    process.once('close', code => resolve({ code, output }));
  });
}

async function r2Get(key, file) {
  const response = await runWrangler(['r2', 'object', 'get', BUCKET + '/' + key,
    '--file', file, '--remote']);
  if (response.code === 0) return readFile(file);
  // Only a definitively missing OBJECT may be imported; auth/network/bucket
  // errors fail closed. Never treat an arbitrary failed get as a missing key.
  if (/\b10007\b|NoSuchKey|Object not found|object does not exist|The specified key does not exist/i.test(response.output)) {
    return null;
  }
  fail('R2 read failed (not a confirmed missing object): ' + key
    + '; Wrangler exit code ' + response.code);
}

async function r2Put(key, file) {
  const r = await runWrangler(['r2', 'object', 'put', BUCKET + '/' + key,
    '--file', file, '--content-type', 'image/gif', '--remote', '--force']);
  if (r.code !== 0) fail('R2 upload failed for ' + key + '; Wrangler exit code ' + r.code);
}

async function downloadApkGif(url, id) {
  // Exact pinned host/path, no redirects to unapproved media sources.
  if (!url.startsWith(CDN_BASE)) fail('Unexpected GIF source for ' + id);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok) fail('APK CDN returned HTTP ' + response.status + ' for ' + id);
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) {
        fail('APK CDN content too large for ' + id);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      validateGifBytes(bytes, id);
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  fail('Failed to fetch original APK GIF for ' + id + ': ' + String(lastError?.message || lastError));
}

async function upload(plan) {
  if (process.env.GITHUB_ACTIONS !== 'true'
      || process.env.GITHUB_REPOSITORY !== REPO
      || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || !process.env.CLOUDFLARE_API_TOKEN) {
    fail('Manual owner-only GitHub Actions upload context and Cloudflare token required');
  }
  const root = await mkdtemp(join(tmpdir(), 'mezfit-gym-keeper-r2-'));
  const counts = { downloadedFromApkCdn: 0, alreadyPresent: 0, uploaded: 0 };
  try {
    for (let i = 0; i < plan.length; i++) {
      const row = plan[i];
      const target = join(root, row.id + '-destination.gif');
      const local = join(root, row.id + '-source.gif');

      const bytes = await downloadApkGif(row.sourceCdn, row.id);
      validateGifBytes(bytes, row.id);
      await writeFile(local, bytes);

      const already = await r2Get(row.targetR2, target);
      if (already) {
        validateGifBytes(already, row.id + ' existing destination');
        if (sha(already) !== sha(bytes)) {
          fail('Existing destination differs; refusing overwrite for ' + row.id);
        }
        counts.alreadyPresent++;
      } else {
        await r2Put(row.targetR2, local);
        const readback = await r2Get(row.targetR2, target);
        if (!readback || sha(readback) !== sha(bytes)) {
          fail('R2 readback SHA-256 mismatch for ' + row.id);
        }
        counts.uploaded++;
      }
      counts.downloadedFromApkCdn++;
      console.log('[' + (i + 1) + '/' + plan.length + '] ' + row.id
        + ' source=original APK CDN sha256=' + sha(bytes) + ' destination=' + row.targetR2);
      await rm(target, { force: true });
      await rm(local, { force: true });
    }
    const report = [
      '### Gym Keeper 112 GIFs — private R2 import',
      '- Prefix: ' + DESTINATION_PREFIX,
      '- Total: ' + plan.length,
      '- Uploaded: ' + counts.uploaded,
      '- Already present (same SHA-256): ' + counts.alreadyPresent,
      '- Source: original Gym Keeper APK CDN: ' + counts.downloadedFromApkCdn,
      '- No existing objects were overwritten. No Dexie Cloud or D1 writes.',
    ].join('\n') + '\n';
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
    }
    console.log(report);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'preview' && mode !== 'upload') fail('Usage: node ... (preview|upload)');
  const plan = await loadPlan(); // Strict full verification precedes every upload.
  if (mode === 'preview') {
    console.log('Validated ' + plan.length + ' unique APK GIF identities absent from Mezfit.');
    console.log('Private R2 destination prefix: ' + DESTINATION_PREFIX);
    for (const p of plan) console.log(p.id + '  ' + p.key + ' -> ' + p.targetR2);
    return;
  }
  await upload(plan);
}

if (process.argv[1]?.endsWith('import-gym-keeper-unmatched-r2.mjs')) {
  main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
}
