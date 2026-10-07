import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sortableListCss = readFileSync(
  new URL('./SortableList.css', import.meta.url),
  'utf8',
);

describe('SortableList lifted surface CSS contract', () => {
  it('does not reintroduce a fixed overlay radius and keeps the lift halo', () => {
    const overlayStart = sortableListCss.indexOf('.ui-sortable-list__overlay {');
    expect(overlayStart).toBeGreaterThanOrEqual(0);
    const overlayEnd = sortableListCss.indexOf('}', overlayStart);
    const overlayRule = sortableListCss.slice(overlayStart, overlayEnd);

    expect(overlayRule).not.toContain('border-radius:');
    expect(overlayRule).toContain('drop-shadow(0 0 18px rgb(255 255 255 / 0.16))');
    expect(overlayRule).toContain('drop-shadow(0 0 36px rgb(170 205 255 / 0.10))');
  });
});
