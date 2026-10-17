#!/usr/bin/env node
/**
 * Protected, data-only update of the existing public exercise catalogue.
 *
 * The stable v2.0 sourceSha256 and schemaVersion deliberately remain unchanged:
 * old clients filter by that digest and may not understand schemaVersion 2.1.0.
 * An additive tracking release marker is activated only after every exercise
 * has been verified. Never deletes data, changes IDs, grants, or realm ownership.
 */
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPublicSession } from './publish-public-catalogue.mjs';
import { prepare, validateCatalogue } from './prepare-public-catalogue.mjs';
import {
  deriveTrackingRelease, ORIGINAL_SHA256, TRACKING_RELEASE_SHA256, TRACKING_SCHEMA_VERSION,
} from './restore-legacy-tracking.mjs';

const DATABASE_URL = 'https://zjv60oxag.dexie.cloud';
const REALM = 'rlm-public';
const MANIFEST_ID = 'mezfit:exercise-catalogue';
const COUNTS = Object.freeze({ publicExerciseDefinitions: 1324, publicExerciseTaxonomy: 69, publicExerciseCatalogues: 1 });
const BATCH_SIZE = 25;

function fail(message) { throw new Error(message); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function byId(rows, name, expectedCount) {
  if (!Array.isArray(rows) || rows.length !== expectedCount) fail(`Unexpected ${name} row count`);
  const map = new Map();
  for (const row of rows) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || map.has(row.id)
        || row.realmId !== REALM || row.owner !== null) fail(`Unsafe ${name} row`);
    map.set(row.id, row);
  }
  return map;
}
function matchesBase(row, expected) {
  return record(row) && Object.entries(expected).every(([key, value]) => isDeepStrictEqual(row[key], value));
}
function compareManifest(active, baseline) {
  if (!record(active) || active.sourceSha256 !== ORIGINAL_SHA256
      || !matchesBase(active, { ...baseline, publishedAt: active.publishedAt })
      || typeof active.publishedAt !== 'string' || !active.publishedAt) {
    fail('Active public manifest differs from the pinned v2.0 source');
  }
  const hasMarker = Object.hasOwn(active, 'trackingSchemaVersion')
    || Object.hasOwn(active, 'trackingReleaseSha256');
  if (hasMarker && (active.trackingSchemaVersion !== TRACKING_SCHEMA_VERSION
      || active.trackingReleaseSha256 !== TRACKING_RELEASE_SHA256)) {
    fail('Conflicting public tracking release marker');
  }
  return hasMarker;
}

/** Fail closed on foreign/unexpected rows and on any non-tracking data change. */
export function trackingUpdatePlan(current, prepared, release) {
  if (!record(current) || !record(prepared) || !record(release)
      || release.schema_version !== TRACKING_SCHEMA_VERSION
      || !Array.isArray(release.exercises) || release.exercises.length !== COUNTS.publicExerciseDefinitions) {
    fail('Invalid tracking update input');
  }
  const baseline = prepared.stage?.data?.[REALM];
  const baselineManifest = prepared.activate?.data?.[REALM]?.publicExerciseCatalogues?.[MANIFEST_ID];
  if (!record(baseline) || !record(baselineManifest)) fail('Invalid canonical release');
  const exercises = byId(current.publicExerciseDefinitions, 'publicExerciseDefinitions', COUNTS.publicExerciseDefinitions);
  const taxonomy = byId(current.publicExerciseTaxonomy, 'publicExerciseTaxonomy', COUNTS.publicExerciseTaxonomy);
  const manifests = byId(current.publicExerciseCatalogues, 'publicExerciseCatalogues', COUNTS.publicExerciseCatalogues);
  const active = manifests.get(MANIFEST_ID);
  if (!active) fail('Missing canonical public manifest');
  const alreadyActive = compareManifest(active, baselineManifest);
  const nextTracking = new Map();
  for (const row of release.exercises) {
    if (!record(row) || typeof row.id !== 'string' || nextTracking.has(row.id)
        || !['weight_reps', 'time_distance'].includes(row.tracking_type)) {
      fail('Invalid tracking classification');
    }
    nextTracking.set(row.id, row.tracking_type);
  }
  const pending = [];
  for (const [id, expected] of Object.entries(baseline.publicExerciseDefinitions)) {
    const actual = exercises.get(id);
    if (!actual || !matchesBase(actual, expected)) {
      fail('Existing public exercise differs from the pinned source; refusing update');
    }
    const tracking = nextTracking.get(id);
    if (!tracking) fail('Missing public exercise tracking classification');
    if (actual.tracking_type === undefined) pending.push({ ...actual, tracking_type: tracking });
    else if (actual.tracking_type !== tracking) fail('Conflicting existing tracking_type; refusing overwrite');
  }
  if (nextTracking.size !== COUNTS.publicExerciseDefinitions) fail('Unknown tracking IDs');
  for (const [id, expected] of Object.entries(baseline.publicExerciseTaxonomy)) {
    const actual = taxonomy.get(id);
    if (!actual || !matchesBase(actual, expected)) fail('Public taxonomy changed; refusing update');
  }
  if (alreadyActive && pending.length) fail('Active tracking release contains incomplete exercises');
  return { pending, alreadyActive, manifestBefore: active, baseline, release,
    unchanged: COUNTS.publicExerciseDefinitions - pending.length };
}

async function readPublic(session) {
  const current = {};
  for (const table of Object.keys(COUNTS)) current[table] = await session.list(table);
  return current;
}
function publicBackup(current) {
  return { data: { [REALM]: Object.fromEntries(Object.entries(current)
    .map(([table, rows]) => [table, Object.fromEntries(rows.map(row => [row.id, row]))])) } };
}

async function verifyTracking(session, plan) {
  const current = await readPublic(session);
  const rows = byId(current.publicExerciseDefinitions, 'publicExerciseDefinitions', COUNTS.publicExerciseDefinitions);
  const taxonomy = byId(current.publicExerciseTaxonomy, 'publicExerciseTaxonomy', COUNTS.publicExerciseTaxonomy);
  const manifests = byId(current.publicExerciseCatalogues, 'publicExerciseCatalogues', COUNTS.publicExerciseCatalogues);
  for (const [id, expected] of Object.entries(plan.baseline.publicExerciseDefinitions)) {
    const actual = rows.get(id);
    const tracking = plan.release.exercises.find(row => row.id === id)?.tracking_type;
    if (!actual || !matchesBase(actual, expected) || actual.tracking_type !== tracking) {
      fail('Tracking readback verification failed; manifest remains unchanged');
    }
  }
  for (const [id, expected] of Object.entries(plan.baseline.publicExerciseTaxonomy)) {
    if (!matchesBase(taxonomy.get(id), expected)) fail('Taxonomy readback changed; refusing activation');
  }
  if (!isDeepStrictEqual(manifests.get(MANIFEST_ID), plan.manifestBefore)) {
    fail('Public manifest changed during staging; refusing activation');
  }
}

export async function executeTrackingUpdate({ session, plan, backupApproved, releaseStored,
  publishedAt = new Date().toISOString() }) {
  if (!backupApproved || !releaseStored) fail('Tracking update requires confirmed R2 backup and verified release');
  await verifyTrackingPlanBeforeWrite(session, plan);
  if (plan.alreadyActive) return { status: 'already-active', exercises: 1324, updated: 0, trackingReleaseSha256: TRACKING_RELEASE_SHA256 };
  for (let i = 0; i < plan.pending.length; i += BATCH_SIZE) {
    await session.put('publicExerciseDefinitions', plan.pending.slice(i, i + BATCH_SIZE));
  }
  await verifyTracking(session, plan);
  const manifest = {
    ...plan.manifestBefore,
    trackingSchemaVersion: TRACKING_SCHEMA_VERSION,
    trackingReleaseSha256: TRACKING_RELEASE_SHA256,
    publishedAt,
  };
  await session.put('publicExerciseCatalogues', [manifest]);
  const final = await session.list('publicExerciseCatalogues');
  const records = byId(final, 'publicExerciseCatalogues', 1);
  if (!matchesBase(records.get(MANIFEST_ID), manifest)) {
    fail('Tracking publication manifest readback failed');
  }
  return { status: 'published', exercises: 1324, updated: plan.pending.length,
    trackingReleaseSha256: TRACKING_RELEASE_SHA256 };
}

/**
 * Guard against changes between the initial read and the first write.
 * A partly staged update remains valid while the v2.0 manifest is active.
 */
async function verifyTrackingPlanBeforeWrite(session, plan) {
  const current = await readPublic(session);
  const manifests = byId(current.publicExerciseCatalogues, 'publicExerciseCatalogues', 1);
  if (!isDeepStrictEqual(manifests.get(MANIFEST_ID), plan.manifestBefore)) {
    fail('Public manifest changed since preview; refusing mutation');
  }
  const rows = byId(current.publicExerciseDefinitions, 'publicExerciseDefinitions', 1324);
  for (const [id, expected] of Object.entries(plan.baseline.publicExerciseDefinitions)) {
    const actual = rows.get(id);
    const desired = plan.release.exercises.find(row => row.id === id)?.tracking_type;
    if (!actual || !matchesBase(actual, expected)
      || (actual.tracking_type !== undefined && actual.tracking_type !== desired)) {
      fail('Public exercises changed since preview; refusing mutation');
    }
  }
  const taxonomy = byId(current.publicExerciseTaxonomy, 'publicExerciseTaxonomy', 69);
  for (const [id, expected] of Object.entries(plan.baseline.publicExerciseTaxonomy)) {
    if (!matchesBase(taxonomy.get(id), expected)) fail('Taxonomy changed since preview');
  }
}

export async function runTrackingUpdate({ sourceBytes, dbUrl, rawKey, mode, backupApproved = false,
  releaseStored = false, fetchFn = fetch }) {
  if (dbUrl !== DATABASE_URL || !['preview', 'backup', 'publish'].includes(mode)) {
    fail('Unexpected tracking update operation/database');
  }
  const { bytes } = deriveTrackingRelease(sourceBytes); // Verifies both pinned SHA-256 values.
  const source = JSON.parse(sourceBytes.toString('utf8'));
  validateCatalogue(source);
  const release = JSON.parse(bytes.toString('utf8'));
  const prepared = await prepare(source, { data: { [REALM]: {} } }, new Date().toISOString());
  const session = await openPublicSession({ dbUrl, rawKey, mode, fetchFn });
  const current = await readPublic(session);
  const plan = trackingUpdatePlan(current, prepared, release);
  if (mode === 'preview') return { status: 'preview', exercises: 1324,
    remaining: plan.pending.length, complete: plan.unchanged, alreadyActive: plan.alreadyActive };
  if (mode === 'backup') return { status: 'backup', payload: publicBackup(current) };
  return executeTrackingUpdate({ session, plan, backupApproved, releaseStored });
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--mode', '--source', '--out'].includes(args[i]) || !args[i + 1]
        || Object.hasOwn(result, args[i])) fail('Invalid tracking update arguments');
    result[args[i]] = args[i + 1];
  }
  if (!['preview', 'backup', 'publish'].includes(result['--mode']) || !result['--source']
      || ((result['--mode'] === 'backup') !== Boolean(result['--out']))) {
    fail('Missing or unexpected tracking update arguments');
  }
  return result;
}

async function main() {
  const opts = options(process.argv.slice(2));
  const config = JSON.parse(await readFile(new URL('../../dexie-cloud.json', import.meta.url)));
  const rawKey = opts['--mode'] === 'preview'
    ? process.env.DEXIE_CLOUD_KEY_JSON : process.env.DEXIE_CLOUD_WRITE_KEY;
  if (!rawKey) fail('Missing Dexie service credentials');
  const result = await runTrackingUpdate({
    sourceBytes: await readFile(opts['--source']), dbUrl: config.dbUrl,
    rawKey, mode: opts['--mode'],
    backupApproved: process.env.DEXIE_PRIVATE_R2_BACKUP_READY === 'yes',
    releaseStored: process.env.DEXIE_TRACKING_RELEASE_R2_READY === 'yes',
  });
  if (opts['--mode'] === 'backup') {
    await writeFile(opts['--out'], JSON.stringify(result.payload), { flag: 'wx', mode: 0o600 });
    console.log('Private public-realm backup prepared');
  } else console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Dexie tracking update failed; inspect the public manifest before retrying');
    process.exitCode = 1;
  });
}
