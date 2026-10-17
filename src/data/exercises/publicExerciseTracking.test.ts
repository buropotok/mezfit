import { describe, expect, it } from 'vitest';
import { resolvePublicExerciseSnapshot } from './publicExerciseCatalogue';
import { isExerciseTrackingType, isPublicExerciseRow, type PublicExerciseCatalogueRow, type PublicExerciseRow, type PublicTaxonomyRow } from './publicExerciseTypes';
import { publicExerciseMediaUrl } from './publicExerciseMedia';

const newSha = 'ee0f313fa15dd8a35a7e6cc558ccd6012810128948e8c8a9e6b5381bf6449c66';
const oldSha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';

function exercise(id: string): PublicExerciseRow {
  return {
    id, realmId: 'rlm-public', owner: null, sourceSha256: newSha,
    name: 'Жим', name_ru: 'Жим', name_en: 'Press', category: 'chest', subcategory: 'upper',
    subcategory_ru: 'Верх груди', movement_type: 'resistance', tracking_type: 'weight_reps',
    muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] }, mobility_targets: [],
    equipment: 'barbell', body_part: 'chest', target: 'chest', muscle_group: 'chest',
    secondary_muscles: [], media_id: 'm', image: 'images/0001-m.jpg', gif_url: 'videos/0001-m.gif',
    attribution: '© Gym visual', created_at: '2026-10-13',
    instructions: { en: 'Press', ru: 'Жим' }, instruction_steps: { en: [], ru: [] },
    source_consistency_issue: null,
    anatomy_evidence: { classification_family: 'press', basis: 'movement', external_individual_match: false },
  };
}

const manifest: PublicExerciseCatalogueRow = {
  id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
  schemaVersion: '2.1.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
  sourceSha256: newSha, exerciseCount: 1324, taxonomyCount: 69,
  subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-17',
};

function taxonomy(id: string): PublicTaxonomyRow {
  return { id, realmId: 'rlm-public', owner: null, sourceSha256: newSha,
    kind: 'muscle', parent_id: null, category_ru: 'Грудь', subcategory_ru: 'Мышца',
    anatomical_description_ru: 'Мышца' };
}

describe('versioned public tracking catalogue', () => {
  it('keeps the legacy row identity check separate from tracking validation', () => {
    expect(isPublicExerciseRow(exercise('0001'))).toBe(true);
    // Reusable programme authoring must tolerate extraneous v2.0 tracking metadata.
    expect(isPublicExerciseRow({ ...exercise('0001'), tracking_type: { legacy: true } })).toBe(true);
    expect(isExerciseTrackingType('incorrect')).toBe(false);
    expect(isExerciseTrackingType({ legacy: true })).toBe(false);
    expect(isExerciseTrackingType('time_weight')).toBe(true);
  });

  it('does not activate a v2.1 catalogue until every exercise has tracking metadata', () => {
    const rows = Array.from({ length: 1324 }, (_, n) => exercise(String(n + 1).padStart(4, '0')));
    const muscles = Array.from({ length: 69 }, (_, n) => taxonomy('muscle-' + n));
    expect(resolvePublicExerciseSnapshot(manifest, rows, muscles).status).toBe('ready');
    rows[0] = { ...rows[0], tracking_type: undefined };
    expect(resolvePublicExerciseSnapshot(manifest, rows, muscles).status).toBe('incomplete');
    const invalidRows = [...rows];
    invalidRows[0] = { ...rows[0], tracking_type: 'unknown' as PublicExerciseRow['tracking_type'] };
    expect(resolvePublicExerciseSnapshot(manifest, invalidRows, muscles).status).toBe('incomplete');
    const oldManifest = { ...manifest, schemaVersion: '2.0.0' as const, sourceSha256: oldSha };
    const oldRows = rows.map(row => ({ ...row, sourceSha256: oldSha }));
    const oldMuscles = muscles.map(row => ({ ...row, sourceSha256: oldSha }));
    expect(resolvePublicExerciseSnapshot(oldManifest, oldRows, oldMuscles).status).toBe('ready');
  });

  it('keeps the same approved GIF identity across v2.0 and v2.1', () => {
    const row = exercise('0001');
    expect(publicExerciseMediaUrl(row)).toContain('/api/exercise-media/gym_keeper_apk/0001');
    expect(publicExerciseMediaUrl({ ...row, sourceSha256: oldSha })).toBe(publicExerciseMediaUrl(row));
    expect(publicExerciseMediaUrl({ ...row, sourceSha256: 'f'.repeat(64) })).toBeNull();
  });
});
