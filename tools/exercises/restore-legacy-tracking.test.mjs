import { describe, expect, it } from 'vitest';
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

describe('legacy tracking catalogue derivation', () => {
  it('preserves all source data while restoring the exact importer mapping', () => {
    const source = fixture();
    const before = structuredClone(source);
    const result = withLegacyTracking(source);
    expect(result.schema_version).toBe(TRACKING_SCHEMA_VERSION);
    expect(result.exercises).toHaveLength(1324);
    expect(result.exercises.filter(row => row.tracking_type === 'time_distance')).toHaveLength(29);
    expect(result.exercises.filter(row => row.tracking_type === 'weight_reps')).toHaveLength(1295);
    expect(source).toEqual(before);
    expect(result.metadata).toEqual(source.metadata);
    expect(result.taxonomy).toEqual(source.taxonomy);
    for (let index = 0; index < 1324; index += 1) {
      const { tracking_type: _tracking, ...unchanged } = result.exercises[index];
      expect(unchanged).toEqual(before.exercises[index]);
    }
  });

  it('rejects incomplete, duplicated or previously migrated input', () => {
    const tooShort = fixture();
    tooShort.exercises.pop();
    expect(() => withLegacyTracking(tooShort)).toThrow(/Unexpected source catalogue/);
    const duplicate = fixture();
    duplicate.exercises[1].id = duplicate.exercises[0].id;
    expect(() => withLegacyTracking(duplicate)).toThrow(/duplicate exercise/);
    const alteredCount = fixture();
    alteredCount.exercises[0].body_part = 'back';
    expect(() => withLegacyTracking(alteredCount)).toThrow(/distribution/);
    const alreadyMigrated = fixture();
    alreadyMigrated.exercises[0].tracking_type = 'time_distance';
    expect(() => withLegacyTracking(alreadyMigrated)).toThrow(/duplicate exercise/);
  });

  it('refuses an R2 source with an unapproved SHA-256', () => {
    expect(() => deriveTrackingRelease(Buffer.from(JSON.stringify(fixture()))))
      .toThrow(/SHA-256 mismatch/);
  });
});
