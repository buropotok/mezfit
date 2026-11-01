#!/usr/bin/env node
/**
 * Publish exactly eight immutable public artwork blobs, with no Cloudflare media path.
 * Uses the existing protected Dexie publisher credential on main/owner manual dispatch.
 * REST /blob stores bytes; /all stores public BlobRefs. No permissions or source PLAN change.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { authorizeCategoryArtworkOperation } from './category-artwork-operator.mjs';
import { parseReadOnlyCredentials } from './diagnose-public-catalogue-rest.mjs';

const DB_URL = 'https://zjv60oxag.dexie.cloud';
const REALM = 'rlm-public';
const TABLE = 'publicExerciseCategoryArtworks';
const LIMIT = 100_000;
const EXPECTED_FILES = Object.freeze({
  chest: ['public/muscles_chest.webp', 'image/webp'],
  arms: ['public/muscles_arm.webp', 'image/webp'],
  back: ['public/muscles_back.webp', 'image/webp'],
  legs: ['public/muscles_leg.webp', 'image/webp'],
  shoulders: ['public/muscles_shoulders.webp', 'image/webp'],
  core: ['public/muscles_core.webp', 'image/webp'],
  full_body: ['public/muscles_fullbody.webp', 'image/webp'],
  cardio: ['public/gym-keeper/categories/muscles_cardio.svg', 'image/svg+xml'],
});
const fail = code => { throw new Error(code); };
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateCategoryArtworkManifest(value) {
  const expected = {
    table: TABLE, realmId: REALM,
    assets: Object.entries(EXPECTED_FILES).map(([category, [file, mime]]) => ({ category, file, mime })),
  };
  if (!isDeepStrictEqual(value, expected)) fail('UNEXPECTED_ARTWORK_ASSET_MANIFEST');
  return value.assets;
}

export function validateCategoryAsset(category, mime, bytes) {
  if (!Object.hasOwn(EXPECTED_FILES, category)
    || EXPECTED_FILES[category][1] !== mime
    || !Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > LIMIT)
    fail('INVALID_CATEGORY_ARTWORK_FILE');
  if (mime === 'image/webp') {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF'
      || bytes.toString('ascii', 8, 12) !== 'WEBP'
      || bytes.readUInt32LE(4) + 8 !== bytes.length
      || !['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)))
      fail('INVALID_CATEGORY_WEBP');
  } else {
    const svg = bytes.toString('utf8');
    if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')
      || !svg.endsWith('</svg>\n') && !svg.endsWith('</svg>')
      || /<script|<foreignObject|<image|(?:href|src)\s*=|<!DOCTYPE|<use|<style/i.test(svg))
      fail('INVALID_CATEGORY_SVG');
  }
  return { category, mime, size: bytes.length, version: sha256(bytes),
    id: 'category-artwork:' + category };
}

async function assetsFromCheckout() {
  const manifest = JSON.parse(await readFile('cloud/category-artwork.json', 'utf8'));
  return Promise.all(validateCategoryArtworkManifest(manifest).map(async ({ category, file, mime }) => {
    const bytes = await readFile(file);
    return { ...validateCategoryAsset(category, mime, bytes), bytes };
  }));
}

function parseRows(payload) {
  const rows = Array.isArray(payload) ? payload
    : record(payload) && Array.isArray(payload.data) ? payload.data : null;
  if (!rows || rows.length > 8 || rows.some(row => !record(row)
    || typeof row.category !== 'string' || row.id !== 'category-artwork:' + row.category
    || !Object.hasOwn(EXPECTED_FILES, row.category)
    || row.realmId !== REALM || row.owner !== null))
    fail('UNEXPECTED_PUBLIC_CATEGORY_ARTWORK_ROWS');
  if (new Set(rows.map(row => row.id)).size !== rows.length)
    fail('DUPLICATE_PUBLIC_CATEGORY_ARTWORK_ROWS');
  return rows;
}

async function responseJson(response) {
  if (!response.ok) fail('DEXIE_CATEGORY_ARTWORK_REQUEST_FAILED');
  try { return await response.json(); } catch { fail('INVALID_DEXIE_CATEGORY_ARTWORK_RESPONSE'); }
}

function expectedRow(asset, ref) {
  return {
    id: asset.id, realmId: REALM, owner: null, category: asset.category,
    version: asset.version, mime: asset.mime, size: asset.size,
    image: { _bt: 'Blob', ref, size: asset.size, ct: asset.mime },
    _hasBlobRefs: 1,
  };
}

export function planCategoryArtworkPublication(existing, assets) {
  const rows = parseRows(existing);
  const byCategory = new Map(rows.map(row => [row.category, row]));
  const pending = [];
  for (const asset of assets) {
    const row = byCategory.get(asset.category);
    if (!row) { pending.push(asset); continue; }
    if (!record(row.image) || typeof row.image.ref !== 'string'
      || !/^[0-9]+:[A-Za-z0-9_-]{6,}$/.test(row.image.ref)
      || !isDeepStrictEqual(row, expectedRow(asset, row.image.ref))) {
      fail('CONFLICTING_PUBLIC_CATEGORY_ARTWORK_ROW');
    }
  }
  if (assets.length !== 8 || byCategory.size > 8) fail('INCOMPLETE_ARTWORK_ASSET_SET');
  return pending;
}

export async function publishCategoryArtwork({ mode, rawKey, fetchFn = fetch, assets }) {
  if (!['preview', 'apply'].includes(mode)) fail('INVALID_CATEGORY_ARTWORK_OPERATION');
  const { clientId, clientSecret } = parseReadOnlyCredentials(rawKey, DB_URL);
  const scopes = mode === 'apply'
    ? ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE'] : ['ACCESS_DB', 'GLOBAL_READ'];
  const tokenResponse = await fetchFn(DB_URL + '/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', scopes,
      client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(20000),
  });
  const token = await responseJson(tokenResponse);
  if (!record(token) || typeof token.accessToken !== 'string' || !token.accessToken)
    fail('INVALID_CATEGORY_ARTWORK_TOKEN');
  const headers = { authorization: 'Bearer ' + token.accessToken };
  const readRows = async () => parseRows(await responseJson(await fetchFn(
    DB_URL + '/all/' + TABLE + '?realmId=' + encodeURIComponent(REALM),
    { headers, signal: AbortSignal.timeout(30000) },
  )));
  const initial = await readRows();
  const pending = planCategoryArtworkPublication(initial, assets);
  if (mode === 'preview') return { status: 'preview', published: initial.length, pending: pending.length };

  // Check again immediately before first mutation. Schema and role checks are owned by the workflow.
  if (!isDeepStrictEqual(await readRows(), initial)) fail('PUBLIC_ARTWORK_CHANGED_DURING_PUBLICATION');
  for (const asset of pending) {
    const response = await fetchFn(DB_URL + '/blob/' + asset.version + '?ct=' + encodeURIComponent(asset.mime), {
      method: 'PUT',
      headers: { ...headers, 'content-type': asset.mime, accept: 'application/json' },
      body: asset.bytes, signal: AbortSignal.timeout(30000),
    });
    const uploaded = await responseJson(response);
    if (!record(uploaded) || typeof uploaded.ref !== 'string'
      || !/^[0-9]+:[A-Za-z0-9_-]{6,}$/.test(uploaded.ref))
      fail('INVALID_CATEGORY_ARTWORK_BLOB_REF');
    const row = expectedRow(asset, uploaded.ref);
    const saved = await fetchFn(DB_URL + '/all/' + TABLE, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify([row]), signal: AbortSignal.timeout(30000),
    });
    if (!saved.ok) fail('PUBLIC_CATEGORY_ARTWORK_WRITE_FAILED');
  }
  const finalRows = await readRows();
  if (planCategoryArtworkPublication(finalRows, assets).length !== 0)
    fail('INCOMPLETE_PUBLIC_CATEGORY_ARTWORK_PUBLICATION');
  // Read back actual bytes, not just the rows pointing to BlobRefs.
  for (const asset of assets) {
    const row = finalRows.find(r => r.id === asset.id);
    const response = await fetchFn(DB_URL + '/blob/' + encodeURIComponent(row.image.ref), {
      headers, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== asset.version)
      fail('PUBLIC_CATEGORY_ARTWORK_BLOB_READBACK_FAILED');
  }
  return { status: pending.length ? 'published' : 'already-active', verified: assets.length };
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['validate', 'preview', 'apply'].includes(mode))
    fail('INVALID_CATEGORY_ARTWORK_COMMAND');
  authorizeCategoryArtworkOperation(process.env);
  if (JSON.parse(await readFile('dexie-cloud.json', 'utf8')).dbUrl !== DB_URL)
    fail('UNEXPECTED_DATABASE_URL');
  const assets = await assetsFromCheckout();
  if (mode === 'validate') {
    console.log(JSON.stringify({ status: 'source-validated', assets: assets.length }));
    return;
  }
  if (mode !== process.env.CATEGORY_ARTWORK_OPERATION) fail('OPERATION_MISMATCH');
  const rawKey = process.env.DEXIE_CLOUD_WRITE_KEY;
  if (!rawKey) fail('MISSING_PROTECTED_PUBLISH_KEY');
  const outcome = await publishCategoryArtwork({ mode, rawKey, assets });
  console.log(JSON.stringify(outcome));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'PUBLIC_CATEGORY_ARTWORK_PUBLICATION_FAILED');
    process.exitCode = 1;
  });
}
