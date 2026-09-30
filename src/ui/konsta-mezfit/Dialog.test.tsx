import { renderToStaticMarkup } from 'react-dom/server';
import { KonstaProvider } from 'konsta/react';
import { describe, expect, it } from 'vitest';
import { MezfitDialog } from './index';

function renderDialog(opened: boolean) {
  return renderToStaticMarkup(
    <KonstaProvider theme="ios" dark>
      <MezfitDialog
        opened={opened}
        title="Mezfit Dialog"
        content="Dialog content"
        buttons={<button type="button">Done</button>}
        role="dialog"
        aria-label="Mezfit Dialog"
      />
    </KonstaProvider>,
  );
}

describe('MezfitDialog', () => {
  it('keeps Konsta Dialog structure while replacing Glass with GlassSurface', () => {
    const html = renderDialog(true);

    expect(html).toContain('Mezfit Dialog');
    expect(html).toContain('Dialog content');
    expect(html).toContain('Done');
    expect(html).toContain('ui-glass-surface');
    expect(html).toContain('ui-glass-surface--host');
    expect(html).toContain('k-glass');
    expect(html).toContain('touch-none');
    expect(html).not.toContain('backdrop-blur-lg');
  });

  it('preserves Konsta opened and closed transition classes', () => {
    const openedHtml = renderDialog(true);
    const closedHtml = renderDialog(false);

    expect(openedHtml).toContain('duration-400');
    expect(closedHtml).toContain('scale-[0.85]');
    expect(closedHtml).toContain('opacity-0');
    expect(closedHtml).toContain('invisible');
    expect(closedHtml).toContain('pointer-events-none');
  });
});
