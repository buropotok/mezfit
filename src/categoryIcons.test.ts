import { describe, expect, it } from 'vitest';
import parityCss from './gym-keeper-exercise-parity.css?raw';

const expected = [
  ['chest', 'muscles_chest.png'],
  ['arms', 'muscles_arm.png'],
  ['back', 'muscles_back.png'],
  ['legs', 'muscles_leg.png'],
  ['shoulders', 'muscles_shoulders.png'],
  ['core', 'muscles_core.png'],
  ['full_body', 'muscles_fullbody.png'],
  ['cardio', 'muscles_cardio.png'],
  ['other', 'muscles_other.png'],
] as const;

describe('Gym Keeper exercise category icons', () => {
  it('maps every exercise category to the exact APK category asset', () => {
    for (const [category, file] of expected) {
      expect(parityCss).toContain(`.category-${category}`);
      expect(parityCss).toContain(`/gym-keeper/categories/${file}`);
    }
  });
});
