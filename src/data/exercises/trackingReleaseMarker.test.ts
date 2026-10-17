import { describe, expect, it } from 'vitest';
import { resolvePublicExerciseSnapshot } from './publicExerciseCatalogue';
import {
  isPublicCatalogueRow, TRACKING_RELEASE_SHA256,
  type PublicExerciseCatalogueRow, type PublicExerciseRow, type PublicTaxonomyRow,
} from './publicExerciseTypes';

const SOURCE_SHA = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const manifest: PublicExerciseCatalogueRow = {
  id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
  schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
  sourceSha256: SOURCE_SHA, exerciseCount: 1324, taxonomyCount: 69,
  subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {},
  publishedAt: '2026-10-17T00:00:00Z',
};
function exercise(id: string): PublicExerciseRow {
  return {
    id, realmId: 'rlm-public', owner: null, sourceSha256: SOURCE_SHA,
    name: 'Жим', name_ru: 'Жим', name_en: 'Press', category: 'chest',
    subcategory: 'upper_chest', subcategory_ru: 'Верх груди',
    movement_type: 'resistance', tracking_type: 'weight_reps',
    muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
    mobility_targets: [], equipment: 'barbell', body_part: 'chest',
    target: 'pectorals', muscle_group: 'chest', secondary_muscles: [],
    media_id: 'm', image: 'images/0001-m.jpg', gif_url: 'videos/0001-m.gif',
    attribution: 'Gym', created_at: '2026-10-17', instructions: { ru: 'Жим', en: 'Press' },
    instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
    anatomy_evidence: { classification_family: 'press', basis: 'name', external_individual_match: false },
  };
}
const taxonomy = (id: string): PublicTaxonomyRow => ({
  id, realmId: 'rlm-public', owner: null, sourceSha256: SOURCE_SHA,
  category_ru: 'Грудь', subcategory_ru: 'Мышца', anatomical_description_ru: 'Мышца',
  kind: 'muscle', parent_id: null,
});

describe('backwards-compatible tracking source release', () => {
  it('allows current and previous clients to keep the original source identity', () => {
    const rows = Array.from({ length: 1324 }, (_, index) => exercise(String(index + 1).padStart(4, '0')));
    const nodes = Array.from({ length: 69 }, (_, index) => taxonomy('muscle-' + index));
    expect(resolvePublicExerciseSnapshot(manifest, rows, nodes).status).toBe('ready');
    const trackingManifest: PublicExerciseCatalogueRow = {
      ...manifest, trackingSchemaVersion: '2.1.0',
      trackingReleaseSha256: TRACKING_RELEASE_SHA256,
    };
    expect(isPublicCatalogueRow(trackingManifest)).toBe(true);
    expect(resolvePublicExerciseSnapshot(trackingManifest, rows, nodes).status).toBe('ready');
    expect(trackingManifest.schemaVersion).toBe('2.0.0');
    expect(trackingManifest.sourceSha256).toBe(SOURCE_SHA);
  });

  it('never activates a declared tracking release with missing or invalid metrics', () => {
    const rows = Array.from({ length: 1324 }, (_, index) => exercise(String(index + 1).padStart(4, '0')));
    const nodes = Array.from({ length: 69 }, (_, index) => taxonomy('muscle-' + index));
    const active = { ...manifest, trackingSchemaVersion: '2.1.0',
      trackingReleaseSha256: TRACKING_RELEASE_SHA256 };
    rows[0] = { ...rows[0], tracking_type: undefined };
    expect(resolvePublicExerciseSnapshot(manifest, rows, nodes).status).toBe('ready');
    expect(resolvePublicExerciseSnapshot(active, rows, nodes).status).toBe('incomplete');
    rows[0] = { ...rows[0], tracking_type: 'unknown' as PublicExerciseRow['tracking_type'] };
    expect(resolvePublicExerciseSnapshot(active, rows, nodes).status).toBe('incomplete');
  });

  it('rejects partial markers and unapproved source hashes', () => {
    expect(isPublicCatalogueRow({ ...manifest, trackingSchemaVersion: '2.1.0' })).toBe(false);
    expect(isPublicCatalogueRow({ ...manifest, trackingReleaseSha256: TRACKING_RELEASE_SHA256 })).toBe(false);
    expect(isPublicCatalogueRow({ ...manifest, trackingSchemaVersion: '2.1.0',
      trackingReleaseSha256: 'a'.repeat(64) })).toBe(false);
  });
});
