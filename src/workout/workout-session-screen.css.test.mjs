/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const pageStyles = [
  readFileSync(new URL('../navigation.css', import.meta.url), 'utf8'),
  readFileSync(new URL('../program/cloud-plan-management.css', import.meta.url), 'utf8'),
  readFileSync(new URL('./workout-session-screen.css', import.meta.url), 'utf8'),
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
    expect(horizontalSpacing(workout)).toEqual({ left: 0, right: 0 });
    expect(Number.parseFloat(getComputedStyle(workout).paddingTop) || 0).toBe(0);
  });
});
