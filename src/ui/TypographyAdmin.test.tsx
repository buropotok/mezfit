import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComponentTypographyAdmin, TypographyRoleAdmin } from './TypographyAdmin';

describe('UI Kit typography admin', () => {
  it('labels every shared typography role and exposes copy/reset controls', () => {
    const html = renderToStaticMarkup(<TypographyRoleAdmin />);
    for (const label of ['Large title', 'Title', 'Headline', 'Body', 'Footnote', 'Caption']) expect(html).toContain(label);
    expect(html).toContain('Main screen title');
    expect(html).toContain('Modal title / important compact heading');
    expect(html.match(/Copy CSS/g)?.length).toBe(6);
    expect(html.match(/Reset/g)?.length).toBe(6);
  });

  it('offers per-element typography editing', () => {
    const html = renderToStaticMarkup(<ComponentTypographyAdmin />);
    for (const label of ['Button', 'Search input', 'Tab', 'Menu item', 'List primary', 'List secondary', 'Modal title', 'Section title']) expect(html).toContain(label);
    expect(html).toContain('Current semantic role: body');
    expect(html).toContain('Copy CSS');
    expect(html).toContain('Reset');
  });
});
