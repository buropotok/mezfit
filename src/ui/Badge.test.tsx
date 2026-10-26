import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, BadgeChoice, type BadgeColor } from './Badge';

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

  it('marks only the selected neutral technique badge', () => {
    const selected = renderToStaticMarkup(<Badge color="gray" selected>Дропсет</Badge>);
    const unselected = renderToStaticMarkup(<Badge color="gray">Дропсет</Badge>);
    expect(selected).toContain('ui-badge--selected');
    expect(unselected).not.toContain('ui-badge--selected');
  });

  it('provides native button semantics with selected and disabled states', () => {
    const pressed = renderToStaticMarkup(<BadgeChoice selected onClick={() => {}}>Кластер</BadgeChoice>);
    expect(pressed).toContain('<button');
    expect(pressed).toContain('aria-pressed="true"');
    expect(pressed).toContain('ui-badge--selected');
    const disabled = renderToStaticMarkup(<BadgeChoice disabled onClick={() => {}}>Дропсет</BadgeChoice>);
    expect(disabled).toContain('disabled=""');
    expect(disabled).toContain('aria-pressed="false"');
  });

  it('uses gray as the default color', () => {
    const html = renderToStaticMarkup(<Badge>Badge</Badge>);
    expect(html).toContain('ui-badge--gray');
  });
});
