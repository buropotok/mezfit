import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiftedGlass } from './LiftedGlass';

describe('LiftedGlass', () => {
  it('renders an app-owned lifted glass surface without Konsta primitive classes', () => {
    const html = renderToStaticMarkup(<LiftedGlass data-testid="lifted">Content</LiftedGlass>);

    expect(html).toContain('class="ui-lifted-glass"');
    expect(html).toContain('data-testid="lifted"');
    expect(html).toContain('Content');
    expect(html).not.toContain('k-glass');
  });
});
