import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sortableListCss = readFileSync(
  new URL('./SortableList.css', import.meta.url),
  'utf8',
);

describe('SortableList lifted surface CSS contract', () => {
  it('leaves radius, material shadow and halo ownership to GlassSurface', () => {
    const overlayStart = sortableListCss.indexOf('.ui-sortable-list__overlay {');
    expect(overlayStart).toBeGreaterThanOrEqual(0);
    const overlayEnd = sortableListCss.indexOf('}', overlayStart);
    const overlayRule = sortableListCss.slice(overlayStart, overlayEnd);

    expect(overlayRule).not.toContain('border-radius:');
    expect(overlayRule).not.toContain('box-shadow:');
    expect(overlayRule).not.toContain('filter:');
  });
});
