import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionExerciseCss = readFileSync(
  new URL('./session-exercise.css', import.meta.url),
  'utf8',
);

function ruleBody(selector) {
  const start = sessionExerciseCss.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sessionExerciseCss.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return sessionExerciseCss.slice(start, end);
}

describe('SessionExercise surface ownership', () => {
  it('keeps the base component geometry-neutral for outer material owners', () => {
    const base = ruleBody('.session-exercise');

    expect(base).not.toContain('background:');
    expect(base).not.toContain('border-radius:');
    expect(base).not.toContain('overflow:');
  });

  it('applies legacy standalone surface geometry only through the explicit modifier', () => {
    const surface = ruleBody('.session-exercise--surface');

    expect(surface).toContain('overflow: hidden');
    expect(surface).toContain('border-radius: var(--ui-radius-md)');
    expect(surface).toContain('background: var(--ui-color-surface)');
  });
});
