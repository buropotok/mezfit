// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const parityCss = readFileSync(new URL('./gym-keeper-exercise-parity.css', import.meta.url), 'utf8');

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

describe('exercise category icons', () => {
  it('maps every exercise category to its category asset', () => {
    for (const [category, file] of expected) {
      expect(parityCss).toContain(`.category-${category}`);
      expect(parityCss).toContain(`/gym-keeper/categories/${file}`);
    }
  });
});
