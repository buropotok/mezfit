import { describe, expect, it } from 'vitest';
import { PUBLIC_EXERCISE_CATEGORIES } from '../data/exercises/publicExerciseFilters';
import { PUBLIC_EXERCISE_CATEGORY_ARTWORK, publicExerciseCategoryArtwork } from './publicExerciseCategoryArtwork';

describe('bundled exercise category illustrations', () => {
  it('maps uploaded category images to local WebP assets and preserves cardio SVG', () => {
    for (const [id] of PUBLIC_EXERCISE_CATEGORIES) {
      if (id === 'other') continue;
      expect(publicExerciseCategoryArtwork(id)).toBe(id === 'cardio'
        ? '/gym-keeper/categories/muscles_cardio.svg'
        : `/muscles_${({ arms: 'arm', legs: 'leg', full_body: 'fullbody' } as Record<string, string>)[id] ?? id}.webp`);
    }
    expect(Object.values(PUBLIC_EXERCISE_CATEGORY_ARTWORK)).toHaveLength(8);
  });

  it('keeps UIkit icon fallback for other/unknown categories without remote images', () => {
    expect(publicExerciseCategoryArtwork('other')).toBeNull();
    expect(publicExerciseCategoryArtwork('untrusted')).toBeNull();
    expect(publicExerciseCategoryArtwork('constructor')).toBeNull();
  });
});
