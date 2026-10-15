import { describe, expect, it } from 'vitest';
import schema from '../../../cloud/schema-coach-exercises.json';
import { CLOUD_DATABASE_STORES_V4, CLOUD_DATABASE_STORES_V5, CLOUD_DATABASE_VERSION } from '../cloud/database';
import { coachFavouriteId, coachOverrideId, isCoachExerciseChanges, resolveCoachExerciseCatalogue } from './coachExerciseTypes';
import type { PublicExerciseRow } from './publicExerciseTypes';
import type { CoachExercisePersonalSnapshot } from './coachExerciseTypes';

const sha = '5ce3e6b15117e115a1e10ac31573eb85eea6bf284a72971e5ca1ee02572aa40c';
const publicExercise: PublicExerciseRow = {
  id: '0001', realmId: 'rlm-public', owner: null, sourceSha256: sha,
  name: 'Bench press', name_ru: 'Жим лёжа', name_en: 'Bench press',
  category: 'chest', subcategory: 'chest', subcategory_ru: 'Грудь',
  movement_type: 'resistance',
  muscles: { primary: [], secondary: [], stabilizers: [], emphasis: [] },
  mobility_targets: [], equipment: 'barbell', body_part: 'chest', target: 'chest',
  muscle_group: 'chest', secondary_muscles: [],
  media_id: '0001', image: '', gif_url: '0001.gif', attribution: '',
  created_at: '2026-01-01', instructions: { ru: '', en: '' },
  instruction_steps: { ru: [], en: [] }, source_consistency_issue: null,
  anatomy_evidence: { classification_family: '', basis: '', external_individual_match: false },
};
const actor = 'tg:42';
const empty = (): CoachExercisePersonalSnapshot => ({ overrides: [], definitions: [], favourites: [] });

describe('Dexie v5 coach catalogue declaration', () => {
  it('is additive and its primary keys match the separately deployed cloud manifest', () => {
    expect(CLOUD_DATABASE_VERSION).toBe(5);
    for (const [table, key] of Object.entries(schema.schema)) {
      expect(CLOUD_DATABASE_STORES_V5[table as keyof typeof CLOUD_DATABASE_STORES_V5]?.split(',')[0]).toBe(key);
      expect(Object.hasOwn(CLOUD_DATABASE_STORES_V4, table)).toBe(false);
    }
    for (const [table, spec] of Object.entries(CLOUD_DATABASE_STORES_V4)) {
      expect(CLOUD_DATABASE_STORES_V5[table as keyof typeof CLOUD_DATABASE_STORES_V5]).toBe(spec);
    }
  });
});

describe('coach-private exercise view', () => {
  it('ignores deprecated overrides and keeps the shared catalogue immutable', () => {
    const personal = empty();
    personal.overrides.push({
      id: coachOverrideId(actor, '0001'), realmId: actor, owner: actor,
      sourceExerciseId: '0001', changes: { name_ru: 'Жим тренера' },
      updatedAt: '2026-10-15',
    });
    const result = resolveCoachExerciseCatalogue([publicExercise], personal, actor);
    expect(result.exercises[0].name_ru).toBe('Жим лёжа');
    expect(result.exercises[0].id).toBe('0001');
    expect(result.exercises[0].sourceSha256).toBe(sha);
    expect(result.exercises[0]).not.toBe(publicExercise);
    expect(publicExercise.name_ru).toBe('Жим лёжа');
  });

  it('merges own custom exercises and favourites and excludes other users and archived rows', () => {
    const personal = empty();
    personal.definitions.push({
      ...publicExercise,
      id: 'custom:11111111-1111-4111-8111-111111111111',
      realmId: actor, owner: actor, sourceSha256: 'coach-custom',
      updatedAt: '2026-10-15', archivedAt: null,
    });
    personal.favourites.push({
      id: coachFavouriteId(actor, '0001'), realmId: actor, owner: actor,
      exerciseId: '0001', createdAt: '2026-10-15',
    }, {
      id: coachFavouriteId('tg:99', '0001'), realmId: 'tg:99', owner: 'tg:99',
      exerciseId: '0001', createdAt: '2026-10-15',
    });
    const result = resolveCoachExerciseCatalogue([publicExercise], personal, actor);
    expect(result.exercises.map(row => row.id)).toEqual(['0001', 'custom:11111111-1111-4111-8111-111111111111']);
    expect([...result.favouriteIds]).toEqual(['0001']);
    personal.definitions[0].archivedAt = '2026-10-16';
    expect(resolveCoachExerciseCatalogue([publicExercise], personal, actor).exercises).toHaveLength(1);
  });

  it('rejects identity changes and malformed patch keys', () => {
    expect(isCoachExerciseChanges({ name_ru: 'Допустимо' })).toBe(true);
    expect(isCoachExerciseChanges({ id: 'injected' })).toBe(false);
    expect(isCoachExerciseChanges({ muscles: { primary: 'bad' } })).toBe(false);
    expect(() => coachOverrideId('other', '0001')).toThrow('INVALID_COACH_EXERCISE_REFERENCE');
    expect(() => coachFavouriteId(actor, 'malformed')).toThrow('INVALID_COACH_EXERCISE_REFERENCE');
  });
});
