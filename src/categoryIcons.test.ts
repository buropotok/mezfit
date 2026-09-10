// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const parityCss = readFileSync(new URL('./gym-keeper-exercise-parity.css', import.meta.url), 'utf8');

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
