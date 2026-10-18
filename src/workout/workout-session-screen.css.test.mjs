import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workoutCss = readFileSync(new URL('./workout-session-screen.css', import.meta.url), 'utf8');
const navigationCss = readFileSync(new URL('../navigation.css', import.meta.url), 'utf8');

describe('WorkoutSessionScreen page spacing', () => {
  it('uses the same shell-owned horizontal gutters as Programs without losing the bottom safe area', () => {
    const workoutRule = workoutCss.match(/\.workout-session-screen\s*\{([^}]*)\}/)?.[1];
    expect(workoutRule).toBeDefined();
    expect(workoutRule).toContain('padding: 0 0 calc(24px + env(safe-area-inset-bottom));');
    expect(navigationCss).toContain('padding-inline: var(--page-pad-x);');
  });
});
