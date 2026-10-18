/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const pageStyles = [
  readFileSync(resolve(process.cwd(), 'src/navigation.css'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'src/program/cloud-plan-management.css'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'src/workout/workout-session-screen.css'), 'utf8'),
].join('\n');

const mounted = [];

afterEach(() => {
  for (const element of mounted) element.remove();
  mounted.length = 0;
});

function horizontalSpacing(element) {
  const style = getComputedStyle(element);
  const pixels = (value) => Number.parseFloat(value) || 0;
  return {
    left: pixels(style.marginLeft) + pixels(style.borderLeftWidth) + pixels(style.paddingLeft),
    right: pixels(style.marginRight) + pixels(style.borderRightWidth) + pixels(style.paddingRight),
  };
}

describe('WorkoutSessionScreen page spacing', () => {
  it('matches the effective Programs gutters inside the same navigation content', () => {
    const stylesheet = document.createElement('style');
    stylesheet.textContent = pageStyles;
    document.head.append(stylesheet);
    mounted.push(stylesheet);

    const navigation = document.createElement('section');
    navigation.className = 'navigation-content';
    const programs = document.createElement('section');
    programs.className = 'cloud-plan-list';
    const workout = document.createElement('section');
    workout.className = 'workout-session-screen';
    navigation.append(programs, workout);
    document.body.append(navigation);
    mounted.push(navigation);

    expect(getComputedStyle(programs).display).toBe('flex');
    expect(getComputedStyle(workout).display).toBe('flex');
    expect(horizontalSpacing(workout)).toEqual(horizontalSpacing(programs));
    expect(Number.parseFloat(getComputedStyle(workout).paddingTop) || 0).toBe(0);
  });
});
