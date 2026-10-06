import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const programsCss = readFileSync(
  new URL('./programs.css', import.meta.url),
  'utf8',
);

function ruleBody(selector) {
  const start = programsCss.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = programsCss.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return programsCss.slice(start, end);
}

describe('ProgramsPage CSS contract', () => {
  it('does not paint legacy surfaces behind the shared glass card or program icon', () => {
    const card = ruleBody('.programs-card');
    const icon = ruleBody('.programs-icon');

    expect(card).not.toContain('background:');
    expect(card).not.toContain('box-shadow:');
    expect(card).not.toContain('border-radius:');
    expect(card).not.toContain('overflow:');
    expect(icon).not.toContain('background:');
  });

  it('owns static-list separators without reaching into SortableList internals', () => {
    expect(programsCss).toContain('.programs-card__content > div + div .programs-row::before');
    expect(programsCss).not.toContain('.programs-card:not(.ui-sortable-list)');
  });
});
