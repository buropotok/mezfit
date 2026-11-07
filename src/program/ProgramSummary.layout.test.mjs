import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./cloud-plan-management.css', import.meta.url), 'utf8');

describe('ProgramSummary participants composition', () => {
  it('keeps owner and athlete adjacent while their discussion controls occupy a separate column', () => {
    const participants = css.split('.cloud-plan-summary-participants {')[1]?.split('}')[0] ?? '';
    expect(participants).toContain('flex-direction: column');
    expect(participants).toContain('gap: 0');
    expect(css).not.toContain('.cloud-plan-person-row');
    const actions = css.split('.cloud-plan-summary-actions {')[1]?.split('}')[0] ?? '';
    expect(actions).toContain('flex-direction: column');
  });
});
