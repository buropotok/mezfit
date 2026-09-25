import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, resolveUiIconPair } from './Icon';

describe('Icon', () => {
  it('resolves a registered icon name through the public renderer', () => {
    const html = renderToStaticMarkup(<Icon name="users" variant="filled" />);

    expect(html).toContain('class="ui-icon"');
    expect(html).toContain('liquid-glass-users-filled.svg');
    expect(html).toContain('aria-hidden="true"');
  });

  it('creates outline and filled artwork from one registered name', () => {
    const pair = resolveUiIconPair('calendar-event');
    const html = renderToStaticMarkup(<>{pair.outline}{pair.filled}</>);

    expect(html).toContain('liquid-glass-calendar-event-outline.svg');
    expect(html).toContain('liquid-glass-calendar-event-filled.svg');
  });
});
