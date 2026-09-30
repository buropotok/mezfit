import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { MezfitSidePanel } from './index';

function renderIosPanel(floating: boolean) {
  return renderToStaticMarkup(
    <KonstaProvider theme="ios" dark>
      <MezfitSidePanel side="right" opened floating={floating}>
        <span>Panel content</span>
      </MezfitSidePanel>
    </KonstaProvider>,
  );
}

describe('MezfitSidePanel', () => {
  it('replaces only the floating iOS Glass renderer with GlassSurface', () => {
    const html = renderIosPanel(true);

    expect(html).toContain('Panel content');
    expect(html).toContain('ui-glass-surface');
    expect(html).toContain('ui-glass-surface--host');
    expect(html).toContain('k-glass');
    expect(html).toContain('touch-none');
    expect(html).not.toContain('backdrop-blur-lg');
  });

  it('keeps the regular Konsta Panel path unchanged when floating is disabled', () => {
    const html = renderIosPanel(false);

    expect(html).toContain('Panel content');
    expect(html).not.toContain('ui-glass-surface');
  });
});
