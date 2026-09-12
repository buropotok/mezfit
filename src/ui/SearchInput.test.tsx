import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchInput } from './index';

describe('SearchInput', () => {
  it('renders an accessible searchbox with Telegram-style shell', () => {
    const html = renderToStaticMarkup(<SearchInput placeholder="Поиск упражнений" />);
    expect(html).toContain('ui-search-input');
    expect(html).toContain('role="searchbox"');
    expect(html).toContain('placeholder="Поиск упражнений"');
    expect(html).toContain('ui-search-input__search-icon');
  });

  it('shows an accessible clear action when controlled value is present', () => {
    const html = renderToStaticMarkup(<SearchInput value="жим" onChange={() => undefined} onClear={() => undefined} />);
    expect(html).toContain('ui-search-input__clear--visible');
    expect(html).toContain('aria-label="Очистить поиск"');
  });

  it('keeps the clear action out of the tab order when empty', () => {
    const html = renderToStaticMarkup(<SearchInput value="" onChange={() => undefined} />);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-hidden="true"');
  });
});
