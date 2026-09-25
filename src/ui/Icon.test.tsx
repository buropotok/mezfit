import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, resolveUiIconPair } from './Icon';

describe('Icon', () => {
  it('resolves a registered icon name through the public renderer', () => {
    const outlineHtml = renderToStaticMarkup(<Icon name="users" variant="outline" />);
    const filledHtml = renderToStaticMarkup(<Icon name="users" variant="filled" />);

    expect(outlineHtml).toContain('class="ui-icon"');
    expect(outlineHtml).toContain('data:image/svg+xml');
    expect(filledHtml).toContain('class="ui-icon"');
    expect(filledHtml).toContain('data:image/svg+xml');
    expect(filledHtml).not.toBe(outlineHtml);
  });

  it('creates distinct outline and filled artwork from one registered name', () => {
    const pair = resolveUiIconPair('calendar-event');
    const outlineHtml = renderToStaticMarkup(pair.outline);
    const filledHtml = renderToStaticMarkup(pair.filled);

    expect(outlineHtml).toContain('class="ui-icon"');
    expect(outlineHtml).toContain('data:image/svg+xml');
    expect(filledHtml).toContain('class="ui-icon"');
    expect(filledHtml).toContain('data:image/svg+xml');
    expect(filledHtml).not.toBe(outlineHtml);
  });
});
