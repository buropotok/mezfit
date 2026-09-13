import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, type BadgeColor } from './Badge';

const colors: BadgeColor[] = ['green', 'yellow', 'blue', 'red', 'orange', 'purple', 'cyan', 'gray'];

describe('Badge', () => {
  it('renders caller-provided content without business-status coupling', () => {
    const html = renderToStaticMarkup(<Badge color="green">Произвольный текст</Badge>);
    expect(html).toContain('Произвольный текст');
    expect(html).toContain('ui-badge--green');
  });

  it.each(colors)('supports the %s color variant', (color) => {
    const html = renderToStaticMarkup(<Badge color={color}>Badge</Badge>);
    expect(html).toContain(`ui-badge--${color}`);
  });

  it('uses gray as the default color', () => {
    const html = renderToStaticMarkup(<Badge>Badge</Badge>);
    expect(html).toContain('ui-badge--gray');
  });
});
