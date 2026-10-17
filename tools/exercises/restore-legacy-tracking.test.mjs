import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTrackingRelease, withLegacyTracking, TRACKING_SCHEMA_VERSION } from './restore-legacy-tracking.mjs';

function fixture() {
  return {
    schema_version: '2.0.0',
    catalogue: 'mezfit.exercise_catalog.ru_anatomy',
    metadata: { exercise_count: 1324, source_id_preserved: true },
    taxonomy: { sample: { label: 'sample' } },
    exercises: Array.from({ length: 1324 }, (_, index) => ({
      id: String(index + 1).padStart(4, '0'),
      name: 'Original name',
      body_part: index < 29 ? 'cardio' : 'back',
      category: index < 29 ? 'cardio' : 'back',
      instructions: { ru: 'Original instruction' },
    })),
  };
}

test('restores exactly the legacy D1 tracking mapping and preserves every other field', () => {
  const source = fixture();
  const before = structuredClone(source);
  const result = withLegacyTracking(source);
  assert.equal(result.schema_version, TRACKING_SCHEMA_VERSION);
  assert.equal(result.exercises.length, 1324);
  assert.equal(result.exercises.filter(row => row.tracking_type === 'time_distance').length, 29);
  assert.equal(result.exercises.filter(row => row.tracking_type === 'weight_reps').length, 1295);
  assert.deepEqual(source, before, 'source must never be mutated');
  assert.deepEqual(result.metadata, source.metadata);
  assert.deepEqual(result.taxonomy, source.taxonomy);
  for (let index = 0; index < 1324; index += 1) {
    const { tracking_type: _tracking, ...unchanged } = result.exercises[index];
    assert.deepEqual(unchanged, before.exercises[index]);
  }
});

test('rejects incomplete, duplicated and already-migrated catalogues', () => {
  const tooShort = fixture();
  tooShort.exercises.pop();
  assert.throws(() => withLegacyTracking(tooShort), /Unexpected source catalogue/);
  const duplicate = fixture();
  duplicate.exercises[1].id = duplicate.exercises[0].id;
  assert.throws(() => withLegacyTracking(duplicate), /duplicate exercise/);
  const alteredCount = fixture();
  alteredCount.exercises[0].body_part = 'back';
  assert.throws(() => withLegacyTracking(alteredCount), /distribution/);
  const alreadyMigrated = fixture();
  alreadyMigrated.exercises[0].tracking_type = 'time_distance';
  assert.throws(() => withLegacyTracking(alreadyMigrated), /duplicate exercise/);
});

test('never accepts an unpinned R2 source', () => {
  assert.throws(() => deriveTrackingRelease(Buffer.from(JSON.stringify(fixture()))),
    /SHA-256 mismatch/);
});
