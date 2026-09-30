import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { MezfitPopover } from './index';

function renderPopover({
  theme = 'ios',
  opened = true,
}: {
  theme?: 'ios' | 'material';
  opened?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <KonstaProvider theme={theme} dark>
      <MezfitPopover opened={opened}>
        <span>Popover content</span>
      </MezfitPopover>
    </KonstaProvider>,
  );
}

describe('MezfitPopover', () => {
  it('replaces only the iOS Konsta Glass renderer with GlassSurface', () => {
    const html = renderPopover();

    expect(html).toContain('Popover content');
    expect(html).toContain('ui-glass-surface');
    expect(html).toContain('ui-glass-surface--host');
    expect(html).toContain('k-glass');
    expect(html).toContain('touch-none');
    expect(html).not.toContain('backdrop-blur-lg');
  });

  it('keeps Konsta opened and closed transition mechanics', () => {
    const openedHtml = renderPopover({ opened: true });
    const closedHtml = renderPopover({ opened: false });

    expect(openedHtml).toContain('duration-400');
    expect(closedHtml).toContain('pointer-events-none');
    expect(closedHtml).toContain('scale-0');
    expect(closedHtml).toContain('-translate-y-20');
  });

  it('keeps the material-theme inner renderer unchanged', () => {
    const html = renderPopover({ theme: 'material' });

    expect(html).toContain('Popover content');
    expect(html).not.toContain('ui-glass-surface');
    expect(html).toContain('k-glass');
    expect(html).toContain('bg-md-light-surface-3');
  });
});
