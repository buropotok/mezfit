import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sortableListCss = readFileSync(
  new URL('./SortableList.css', import.meta.url),
  'utf8',
);
const sortableListSource = readFileSync(
  new URL('./SortableList.tsx', import.meta.url),
  'utf8',
);

function ruleBody(selector) {
  const start = sortableListCss.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sortableListCss.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return sortableListCss.slice(start, end);
}

describe('SortableList lifted surface contract', () => {
  it('uses the lifted GlassSurface itself as the only overlay geometry owner', () => {
    const overlay = ruleBody('.ui-sortable-list__overlay');

    expect(sortableListSource).toContain('<GlassSurface className="ui-sortable-list__overlay" preset="modalTuned">');
    expect(sortableListSource).not.toContain('<div className="ui-sortable-list__overlay">');
    expect(overlay).not.toContain('border-radius:');
  });

  it('inherits optics and material shadow while preserving the DaySchedule-style halo', () => {
    expect(sortableListSource).not.toContain('optics={');
    expect(sortableListSource).not.toContain('glass={{ shadow: 0 }}');
    expect(sortableListCss).toContain('drop-shadow(0 0 18px rgb(255 255 255 / 0.16))');
    expect(sortableListCss).toContain('drop-shadow(0 0 36px rgb(170 205 255 / 0.10))');
  });
});
