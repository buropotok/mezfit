import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Menu, MenuItem } from './index';

describe('UI Kit Menu', () => {
  it('renders an accessible Radix trigger', () => {
    const html = renderToStaticMarkup(
      <Menu
        isOpen={false}
        onClose={() => {}}
        label="Actions"
        trigger={<button type="button">Actions</button>}
      >
        <MenuItem>Информация</MenuItem>
      </Menu>,
    );
    expect(html).toContain('<button');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('Actions');
  });

  it('keeps item presentation inside the Mezfit Menu wrapper', () => {
    expect(() => renderToStaticMarkup(
      <Menu
        isOpen={false}
        onClose={() => {}}
        trigger={<button type="button">Actions</button>}
      >
        <MenuItem active leading={<span>i</span>}>Редактировать</MenuItem>
      </Menu>,
    )).not.toThrow();
  });
});
