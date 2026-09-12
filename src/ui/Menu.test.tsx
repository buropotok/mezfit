import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Menu, MenuItem } from './index';

describe('UI Kit Menu', () => {
  it('renders an accessible Radix trigger', () => {
    const html = renderToStaticMarkup(<Menu isOpen={false} onClose={() => {}} label="Actions" trigger={<button type="button">Actions</button>}><MenuItem>Информация</MenuItem></Menu>);
    expect(html).toContain('<button');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('Actions');
  });

  it('keeps item presentation in the Mezfit wrapper API', () => {
    const html = renderToStaticMarkup(<MenuItem active leading={<span>i</span>}>Редактировать</MenuItem>);
    expect(html).toContain('ui-menu-item--active');
    expect(html).toContain('ui-menu-item__leading');
    expect(html).toContain('Редактировать');
  });
});
