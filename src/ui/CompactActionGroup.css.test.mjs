import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const groupCss = readFileSync(new URL('./compact-action-group.css', import.meta.url), 'utf8');
const buttonCss = readFileSync(new URL('./ui.css', import.meta.url), 'utf8');

it('keeps compact action slots 44px wide and high with no gap', () => {
  expect(groupCss).toContain('gap: 0;');
  expect(groupCss).toContain('flex: 0 0 44px;');
  expect(groupCss).toContain('width: 44px;');
  expect(groupCss).toContain('height: 44px;');
  expect(buttonCss).toContain('.ui-icon-button.ui-icon-button--compact { width: 44px; height: 44px; min-height: 44px; }');
});
