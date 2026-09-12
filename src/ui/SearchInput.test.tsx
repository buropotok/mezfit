import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchInput } from './SearchInput';

describe('SearchInput', () => {
  it('renders an accessible search field', () => {
    const html = renderToStaticMarkup(<SearchInput aria-label="Поиск упражнения" placeholder="Поиск" />);
    expect(html).toContain('type="search"');
    expect(html).toContain('role="searchbox"');
    expect(html).toContain('aria-label="Поиск упражнения"');
  });
  it('shows an accessible clear action when controlled value is present and clear is owned by the caller', () => {
    const html = renderToStaticMarkup(<SearchInput value="жим" onChange={() => undefined} onClear={() => undefined} />);
    expect(html).toContain('ui-search-input__clear--visible');
    expect(html).toContain('aria-label="Очистить поиск"');
  });
  it('renders an uncontrolled default value from component-owned state', () => {
    const html = renderToStaticMarkup(<SearchInput defaultValue="жим" />);
    expect(html).toContain('value="жим"');
    expect(html).toContain('ui-search-input__clear--visible');
  });
  it('keeps clear out of the tab order for an empty value', () => {
    const html = renderToStaticMarkup(<SearchInput value="" onChange={() => undefined} />);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('disabled');
  });
});
