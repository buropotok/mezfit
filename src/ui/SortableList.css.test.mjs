import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sortableListCss = readFileSync(
  new URL('./SortableList.css', import.meta.url),
  'utf8',
);

describe('SortableList CSS contract', () => {
  it('uses the DaySchedule lift halo for the active DnD tile', () => {
    expect(sortableListCss).toContain('border-radius: var(--ui-radius-md)');
    expect(sortableListCss).toContain('0 0 18px rgb(255 255 255 / 0.16)');
    expect(sortableListCss).toContain('0 0 36px rgb(170 205 255 / 0.10)');
  });
});
