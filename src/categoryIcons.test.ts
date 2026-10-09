import { describe, expect, it } from 'vitest';
import { categoryMediaUrls } from './exercises/exerciseCategoryMedia';

const expected = [
  ['chest', 'muscles_chest.svg'],
  ['arms', 'muscles_arm.svg'],
  ['back', 'muscles_back.svg'],
  ['legs', 'muscles_leg.svg'],
  ['shoulders', 'muscles_shoulders.svg'],
  ['core', 'muscles_core.svg'],
  ['full_body', 'muscles_fullbody.svg'],
  ['cardio', 'muscles_cardio.svg'],
  ['other', 'muscles_other.png'],
] as const;

describe('exercise category media', () => {
  it('maps every exercise category to its category asset', () => {
    for (const [category, file] of expected) {
      expect(categoryMediaUrls[category]).toContain(file);
    }
  });
});
