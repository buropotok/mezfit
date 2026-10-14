import { describe, expect, it } from 'vitest';
import { PUBLIC_EXERCISE_CATEGORIES } from '../data/exercises/publicExerciseFilters';
import { PUBLIC_EXERCISE_CATEGORY_ARTWORK, publicExerciseCategoryArtwork } from './publicExerciseCategoryArtwork';

describe('bundled exercise category illustrations', () => {
  it('maps each supported category to an immutable local SVG asset', () => {
    for (const [id] of PUBLIC_EXERCISE_CATEGORIES) {
      if (id === 'other') continue;
      expect(publicExerciseCategoryArtwork(id)).toMatch(/^\/gym-keeper\/categories\/muscles_[a-z]+\.svg$/);
    }
    expect(Object.values(PUBLIC_EXERCISE_CATEGORY_ARTWORK)).toHaveLength(8);
  });

  it('keeps UIkit icon fallback for other/unknown categories without remote images', () => {
    expect(publicExerciseCategoryArtwork('other')).toBeNull();
    expect(publicExerciseCategoryArtwork('untrusted')).toBeNull();
    expect(publicExerciseCategoryArtwork('constructor')).toBeNull();
  });
});
