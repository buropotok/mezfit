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

  it('has no legacy static program-card surface to swap in during mutations', () => {
    expect(programsCss).not.toContain('.programs-card--static');
    expect(programsCss).not.toContain('background:var(--ui-color-surface)');
    expect(programsCss).not.toContain('box-shadow:var(--ui-shadow-raised)');
  });
});
