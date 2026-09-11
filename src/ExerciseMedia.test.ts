import { describe, expect, it } from 'vitest';
import { exerciseMediaUrl } from './ExerciseMedia';

const datasetExercise = {
  reference_source: 'github_exercises_dataset',
  reference_key: '0001-2gPfomN.gif',
};

describe('exercise media URL', () => {
  it('uses the stable same-origin media route for the canonical dataset', () => {
    expect(exerciseMediaUrl(datasetExercise))
      .toBe('/api/exercise-media/gym_keeper_apk/0001-2gPfomN.gif');
  });

  it('returns no URL for legacy or custom media sources', () => {
    expect(exerciseMediaUrl({ reference_source: null, reference_key: null })).toBeNull();
    expect(exerciseMediaUrl({ reference_source: 'gym_keeper_apk', reference_key: 'legacy.gif' })).toBeNull();
    expect(exerciseMediaUrl({ reference_source: 'coach', reference_key: 'custom.gif' })).toBeNull();
  });
});
