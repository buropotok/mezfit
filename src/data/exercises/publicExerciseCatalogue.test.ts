import { describe, expect, it } from 'vitest';
import { resolvePublicExerciseSnapshot } from './publicExerciseCatalogue';
import type { PublicExerciseCatalogueRow, PublicExerciseRow, PublicTaxonomyRow } from './publicExerciseTypes';

const sha = 'a'.repeat(64);
const manifest: PublicExerciseCatalogueRow = {
  id: 'mezfit:exercise-catalogue', realmId: 'rlm-public', owner: null,
  schemaVersion: '2.0.0', catalogue: 'mezfit.exercise_catalog.ru_anatomy',
  sourceSha256: sha, exerciseCount: 1324, taxonomyCount: 69,
  subcategoryLabelsRu: {}, movementFamilyReferences: {}, metadata: {}, publishedAt: '2026-10-13T00:00:00Z',
};
const row = (id: string): PublicExerciseRow => ({
  id, realmId: 'rlm-public', owner: null, sourceSha256: sha,
  name: 'Жим', name_ru: 'Жим', name_en: 'Press', category: 'chest', subcategory: 'upper_chest',
  subcategory_ru: 'Верх груди', movement_type: 'resistance',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] }, mobility_targets: [],
  equipment: 'barbell', body_part: 'chest', target: 'pectorals', muscle_group: 'chest',
  secondary_muscles: [], media_id: 'm', image: 'images/0001-m.jpg', gif_url: 'videos/0001-m.gif',
  attribution: '© Gym visual', created_at: '2026-10-13T00:00:00Z',
  instructions: { en: 'Press.', ru: 'Жим.' }, instruction_steps: { en: [], ru: [] },
  source_consistency_issue: null,
  anatomy_evidence: { classification_family: 'press', basis: 'name', external_individual_match: false },
});
const node = (id: string): PublicTaxonomyRow => ({
  id, realmId: 'rlm-public', owner: null, sourceSha256: sha,
  kind: 'muscle', parent_id: null, category_ru: 'Грудь', subcategory_ru: 'Мышца', anatomical_description_ru: 'Мышца',
});

describe('public catalogue publication boundary', () => {
  it('does not show records before manifest activation', () => {
    expect(resolvePublicExerciseSnapshot(undefined, [row('0001')], [node('muscle')]).status)
      .toBe('unpublished');
  });
  it('rejects invalid publication metadata before reading synced rows', () => {
    const malformed = { ...manifest, subcategoryLabelsRu: null };
    expect(resolvePublicExerciseSnapshot(malformed, [], []).status).toBe('invalid');
  });
  it('never displays a partial import', () => {
    expect(resolvePublicExerciseSnapshot(manifest, [row('0001')], [node('muscle')]).status)
      .toBe('incomplete');
  });
  it('admits only a completely verified matching release', () => {
    const exercises = Array.from({ length: 1324 }, (_, n) => row(String(n).padStart(4, '0')));
    const taxonomy = Array.from({ length: 69 }, (_, n) => node(`muscle-${n}`));
    expect(resolvePublicExerciseSnapshot(manifest, exercises, taxonomy).status).toBe('ready');
    const invalidTaxonomy = [...taxonomy];
    invalidTaxonomy[0] = { ...taxonomy[0], kind: 'INVALID' as PublicTaxonomyRow['kind'] };
    expect(resolvePublicExerciseSnapshot(manifest, exercises, invalidTaxonomy).status).toBe('incomplete');
    exercises[0] = { ...exercises[0], sourceSha256: 'b'.repeat(64) };
    expect(resolvePublicExerciseSnapshot(manifest, exercises, taxonomy).status).toBe('incomplete');
  });
});
