import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Menu, MenuDivider, MenuItem } from './index';

describe('UI Kit Menu', () => {
  it('renders menu semantics and item content when open', () => {
    const html = renderToStaticMarkup(<Menu isOpen onClose={() => {}} label="Actions"><MenuItem leading={<span>i</span>}>Информация</MenuItem><MenuDivider /><MenuItem active>Редактировать</MenuItem></Menu>);
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Actions"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('ui-menu-item--active');
  });

  it('does not render when initially closed', () => {
    expect(renderToStaticMarkup(<Menu isOpen={false} onClose={() => {}}><MenuItem>Hidden</MenuItem></Menu>)).toBe('');
  });
});
