import type { CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { MezfitSidePanel } from './index';

function renderIosPanel(floating: boolean, style?: CSSProperties) {
  return renderToStaticMarkup(
    <KonstaProvider theme="ios" dark>
      <MezfitSidePanel side="right" opened floating={floating} style={style}>
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
    expect(html).toContain('will-change:transform');
    expect(html).not.toContain('backdrop-blur-lg');
  });

  it('preserves an explicit caller willChange value', () => {
    const html = renderIosPanel(true, { willChange: 'opacity' });

    expect(html).toContain('will-change:opacity');
    expect(html).not.toContain('will-change:transform');
  });

  it('keeps the regular Konsta Panel path unchanged when floating is disabled', () => {
    const html = renderIosPanel(false);

    expect(html).toContain('Panel content');
    expect(html).not.toContain('ui-glass-surface');
  });
});
