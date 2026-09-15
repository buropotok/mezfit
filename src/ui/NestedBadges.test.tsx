import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NestedBadges } from './NestedBadges';

describe('NestedBadges', () => {
  it('renders nested badge items and supporting info', () => {
    const html = renderToStaticMarkup(
      <NestedBadges items={[{
        id: 'parent',
        label: 'Родитель',
        color: 'blue',
        info: 'Инф.',
        children: [{ id: 'child', label: 'Дочерний', color: 'green' }],
      }]} />,
    );

    expect(html).toContain('Родитель');
    expect(html).toContain('Дочерний');
    expect(html).toContain('Инф.');
    expect(html).toContain('ui-badge--blue');
    expect(html).toContain('ui-badge--green');
    expect(html).toContain('padding-inline-start:var(--ui-nested-badges-indent)');
  });

  it('renders zero-valued supporting info', () => {
    const html = renderToStaticMarkup(
      <NestedBadges items={[{ id: 'zero', label: 'Счётчик', info: 0 }]} />,
    );

    expect(html).toContain('ui-nested-badges__info');
    expect(html).toContain('>0</span>');
  });
});
