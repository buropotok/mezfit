#!/usr/bin/env node
/**
 * Derive a versioned tracking-enabled public catalogue from the pinned immutable
 * R2 source. This is an offline preparation step; it never writes to Dexie Cloud.
 *
 * The legacy D1 importer assigned time_distance only when
 * (body_part || category).toLowerCase() === 'cardio'; every other public exercise
 * received weight_reps. Personal coach overrides are not global catalogue data.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGINAL_SHA256 = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
export const TRACKING_SCHEMA_VERSION = '2.1.0';
const EXPECTED_EXERCISES = 1324;
const EXPECTED_CARDIO = 29;

function fail(message) { throw new Error(message); }

export function withLegacyTracking(source) {
  if (!source || source.schema_version !== '2.0.0'
      || source.catalogue !== 'mezfit.exercise_catalog.ru_anatomy'
      || source.metadata?.exercise_count !== EXPECTED_EXERCISES
      || !Array.isArray(source.exercises) || source.exercises.length !== EXPECTED_EXERCISES) {
    fail('Unexpected source catalogue: refusing to derive a tracking release');
  }
  const ids = new Set();
  let cardioCount = 0;
  const exercises = source.exercises.map((row) => {
    if (!row || typeof row.id !== 'string' || !/^\d{4}$/.test(row.id)
        || ids.has(row.id) || Object.hasOwn(row, 'tracking_type')) {
      fail('Unexpected or duplicate exercise in source catalogue');
    }
    ids.add(row.id);
    const bodyPart = row.body_part || row.category || '';
    if (typeof bodyPart !== 'string' || !bodyPart.trim()) {
      fail('Source exercise lacks a tracking classification input');
    }
    const isCardio = bodyPart.toLowerCase() === 'cardio';
    if (isCardio) cardioCount += 1;
    return { ...row, tracking_type: isCardio ? 'time_distance' : 'weight_reps' };
  });
  if (cardioCount !== EXPECTED_CARDIO || ids.size !== EXPECTED_EXERCISES) {
    fail('Legacy tracking distribution or ID count differs from the pinned source');
  }
  return { ...source, schema_version: TRACKING_SCHEMA_VERSION, exercises };
}

export function deriveTrackingRelease(sourceBytes) {
  const digest = createHash('sha256').update(sourceBytes).digest('hex');
  if (digest !== ORIGINAL_SHA256) fail('Original source SHA-256 mismatch');
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const release = withLegacyTracking(source);
  const bytes = Buffer.from(JSON.stringify(release, null, 2) + '\n', 'utf8');
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) {
    fail('Usage: node tools/exercises/restore-legacy-tracking.mjs INPUT_R2_JSON OUTPUT_JSON');
  }
  const { bytes, sha256 } = deriveTrackingRelease(await readFile(input));
  await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ schemaVersion: TRACKING_SCHEMA_VERSION,
    exercises: EXPECTED_EXERCISES, weight_reps: EXPECTED_EXERCISES - EXPECTED_CARDIO,
    time_distance: EXPECTED_CARDIO, sha256 }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Tracking release preparation failed');
    process.exitCode = 1;
  });
}
