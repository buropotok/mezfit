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
  it('does not paint a legacy surface behind sortable glass or behind the program icon', () => {
    const card = ruleBody('.programs-card');
    const icon = ruleBody('.programs-icon');

    expect(card).not.toContain('background:');
    expect(card).not.toContain('box-shadow:');
    expect(card).not.toContain('border-radius:');
    expect(card).not.toContain('overflow:');
    expect(icon).not.toContain('background:');
  });

  it('keeps the legacy surface scoped to non-sortable cards without reaching into SortableList internals', () => {
    const staticCard = ruleBody('.programs-card--static');

    expect(staticCard).toContain('background:var(--ui-color-surface)');
    expect(staticCard).toContain('box-shadow:var(--ui-shadow-raised)');
    expect(programsCss).toContain('.programs-card--static > div + div .programs-row::before');
    expect(programsCss).not.toContain('.programs-card:not(.ui-sortable-list)');
  });
});
