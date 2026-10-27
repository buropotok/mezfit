/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const styles = [
  'src/navigation.css',
  'src/coach/programs.css',
  'src/workout/adhoc-workouts.css',
].map(path => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

const mounted = [];
afterEach(() => {
  for (const node of mounted) node.remove();
  mounted.length = 0;
});

describe('workout screen gutters', () => {
  it('uses the same navigation-owned horizontal and top spacing as Programs', () => {
    const sheet = document.createElement('style');
    sheet.textContent = styles;
    document.head.append(sheet);
    mounted.push(sheet);

    const navigation = document.createElement('section');
    navigation.className = 'navigation-content';
    const programs = document.createElement('section');
    programs.className = 'programs-page';
    const workout = document.createElement('section');
    workout.className = 'adhoc-workouts';
    navigation.append(programs, workout);
    document.body.append(navigation);
    mounted.push(navigation);

    const gutters = element => {
      const css = getComputedStyle(element);
      const px = value => Number.parseFloat(value) || 0;
      return [px(css.paddingLeft), px(css.paddingRight), px(css.paddingTop)];
    };
    expect(gutters(workout)).toEqual(gutters(programs));
    expect(getComputedStyle(workout).display).toBe('flex');
  });
});
