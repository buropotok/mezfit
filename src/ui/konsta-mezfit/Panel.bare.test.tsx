import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { MezfitSidePanel } from './index';

describe('MezfitSidePanel bare surface', () => {
  it('keeps Konsta panel mechanics without rendering GlassSurface', () => {
    const html = renderToStaticMarkup(
      <KonstaProvider theme="ios" dark>
        <MezfitSidePanel
          side="right"
          opened
          floating
          surface="bare"
          backdropClassName="test-backdrop"
        >
          <span>Panel content</span>
        </MezfitSidePanel>
      </KonstaProvider>,
    );

    expect(html).toContain('Panel content');
    expect(html).toContain('test-backdrop');
    expect(html).toContain('k-panel');
    expect(html).not.toContain('ui-glass-surface');
  });
});
