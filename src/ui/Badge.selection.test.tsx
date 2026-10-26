import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('selectable UI Kit Badge for set types', () => {
  it('keeps the original Badge unchanged unless the outline variant is requested', () => {
    const legacy = renderToStaticMarkup(<Badge color="gray">Кластер</Badge>);
    expect(legacy).not.toContain('ui-badge--outline');
    expect(legacy).not.toContain('ui-badge--selected');
  });

  it('renders neutral and selected prototype states without introducing new colors', () => {
    const idle = renderToStaticMarkup(<Badge color="gray" variant="outline">Дропсет</Badge>);
    const selected = renderToStaticMarkup(<Badge color="gray" variant="outline" selected>Дропсет</Badge>);
    expect(idle).toContain('ui-badge--gray ui-badge--outline');
    expect(idle).not.toContain('ui-badge--selected');
    expect(selected).toContain('ui-badge--gray ui-badge--outline ui-badge--selected');
  });
});
