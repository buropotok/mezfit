import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./today-page.css', import.meta.url), 'utf8');

describe('TodayPage sheet layering contract', () => {
  it('contains DaySchedule z-indexes below navigation overlays', () => {
    expect(css).toContain('.today-page__schedule');
    expect(css).toContain('z-index: 0');
  });

  it('blocks schedule pointer input while a creation sheet is open', () => {
    expect(css).toContain('.today-page--sheet-open .today-page__schedule');
    expect(css).toContain('pointer-events: none');
  });
});
