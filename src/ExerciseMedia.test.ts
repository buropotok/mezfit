import { describe, expect, it } from 'vitest';
import { exerciseMediaUrl } from './ExerciseMedia';

const birdDog = {
  reference_source: 'gym_keeper_apk',
  reference_key: '12411305-Bird-Dog-male_Back_180.gif',
};

describe('exercise media URL', () => {
  it('uses the stable same-origin Gym Keeper media route', () => {
    expect(exerciseMediaUrl(birdDog))
      .toBe('/api/exercise-media/gym_keeper_apk/12411305-Bird-Dog-male_Back_180.gif');
  });

  it('returns no URL for exercises without approved bundled media', () => {
    expect(exerciseMediaUrl({ reference_source: null, reference_key: null })).toBeNull();
    expect(exerciseMediaUrl({ reference_source: 'coach', reference_key: 'custom.gif' })).toBeNull();
  });
});
