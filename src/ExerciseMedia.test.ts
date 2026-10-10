import { describe, expect, it } from 'vitest';
import { exerciseMediaUrl } from './ExerciseMedia';

const datasetExercise = {
  reference_source: 'github_exercises_dataset',
  reference_key: '0001',
  reference_media_url: 'https://cdn.example/ignored.gif',
};

describe('exercise media URL', () => {
  it('uses the stable same-origin media route for the canonical dataset', () => {
    expect(exerciseMediaUrl(datasetExercise))
      .toBe('/api/exercise-media/gym_keeper_apk/0001');
  });

  it('returns no URL for legacy or custom media sources', () => {
    expect(exerciseMediaUrl({ reference_source: null, reference_key: null, reference_media_url: null })).toBeNull();
    expect(exerciseMediaUrl({ reference_source: 'gym_keeper_apk', reference_key: 'legacy.gif', reference_media_url: null })).toBeNull();
    expect(exerciseMediaUrl({ reference_source: 'coach', reference_key: 'custom.gif', reference_media_url: null })).toBeNull();
  });

  it('uses a direct media URL when the exercise is not from the canonical dataset', () => {
    expect(exerciseMediaUrl({
      reference_source: 'coach',
      reference_key: null,
      reference_media_url: 'https://cdn.example/custom.gif',
    })).toBe('https://cdn.example/custom.gif');
  });
});
