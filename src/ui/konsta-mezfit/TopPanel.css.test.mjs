import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const topPanelCss = readFileSync(
  new URL('./top-panel.css', import.meta.url),
  'utf8',
);

describe('MezfitTopPanel CSS contract', () => {
  it('starts below the navigation frame and only dims the panel surface', () => {
    expect(topPanelCss).toContain('--navigation-content-start');
    expect(topPanelCss).toContain('z-index: 50');
    expect(topPanelCss).toContain('.ui-mezfit-top-panel__surface--bare');
    expect(topPanelCss).toContain('background: rgba(0, 0, 0, .56)');
    expect(topPanelCss).toContain('blur(var(--ui-mezfit-top-panel-blur))');
  });

  it('reserves vertical touch gestures for swipe-up while keeping month panning horizontal', () => {
    expect(topPanelCss).toContain('touch-action: pan-x');
    expect(topPanelCss).not.toContain('touch-action: pan-x pan-y');
  });
});
