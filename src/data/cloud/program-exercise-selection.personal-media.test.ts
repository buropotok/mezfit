import { describe, expect, it } from 'vitest';
import { programExerciseSnapshot } from './program-exercise-selection';
import type { CatalogueExerciseRow } from '../exercises/coachExerciseTypes';
import { isAssignedCoachExerciseSnapshot } from './workout-foundation-types';

const url = '/api/exercise-media/personal/11111111-1111-4111-8111-111111111111?v=' + 'a'.repeat(64);

const exercise: CatalogueExerciseRow = {
  id: 'custom:22222222-2222-4222-8222-222222222222',
  realmId: 'tg:101', owner: 'tg:101', sourceSha256: 'coach-custom',
  name: 'Жим', name_ru: 'Жим', name_en: '', category: 'chest',
  subcategory: '', subcategory_ru: '', movement_type: 'resistance',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: '', body_part: '', target: '', muscle_group: '',
  secondary_muscles: [], media_id: '', image: url, gif_url: '', attribution: '',
  created_at: '', instructions: { ru: '', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};

describe('personal R2 media in immutable exercise snapshots', () => {
  it('captures the media URL in coach-created programs accessible to clients', () => {
    const snapshot = programExerciseSnapshot(exercise, 'tg:101');
    expect(snapshot.mediaUrl).toBe(url);
    expect(snapshot.catalogueDefinition?.image).toBe(url);
    expect(isAssignedCoachExerciseSnapshot(snapshot, 'tg:101')).toBe(true);
  });

  it('does not copy uploaded media from an untrusted public record', () => {
    const snapshot = programExerciseSnapshot({
      ...exercise, id: '0001', realmId: 'rlm-public', owner: null,
      sourceSha256: '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c',
      image: url,
    }, 'tg:101');
    expect(snapshot.mediaUrl).toBeNull();
    expect(snapshot.catalogueDefinition).toBeUndefined();
  });
});
