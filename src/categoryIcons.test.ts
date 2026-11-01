// @ts-expect-error Vitest runs this test in Node; production tsconfig intentionally omits Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const parityCss = readFileSync(new URL('./gym-keeper-exercise-parity.css', import.meta.url), 'utf8');

describe('legacy category icon isolation', () => {
  it('does not request any category artwork from Cloudflare static assets', () => {
    expect(parityCss).not.toContain('/gym-keeper/categories/');
    expect(parityCss).not.toContain('--gk-category-icon');
    expect(parityCss).not.toContain('background: center / contain no-repeat');
  });
});
