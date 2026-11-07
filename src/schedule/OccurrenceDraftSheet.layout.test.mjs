import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./occurrence-draft-sheet.css', import.meta.url), 'utf8');

describe('OccurrenceDraftSheet discussion action layout', () => {
  it('places the icon to the right without displacing athlete and format rows', () => {
    const overview = css.split('.occurrence-draft-sheet__overview {')[1]?.split('}')[0] ?? '';
    expect(overview).toContain('display: flex');
    expect(overview).toContain('justify-content: space-between');
    const details = css.split('.occurrence-draft-sheet__overview-details {')[1]?.split('}')[0] ?? '';
    expect(details).toContain('flex-direction: column');
    expect(details).toContain('gap: 16px');
    const action = css.split('.occurrence-draft-sheet__discussion-action {')[1]?.split('}')[0] ?? '';
    expect(action).toContain('flex-shrink: 0');
  });
});
