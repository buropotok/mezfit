/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it } from 'vitest';
import { LiquidPopover } from './LiquidPopover';

afterEach(() => cleanup());

it('keeps ordinary menu row geometry while rendering the optional colored icon and separate pencil slot', () => {
  const ref = createRef<HTMLButtonElement>();
  const view = render(<LiquidPopover isOpen={false} onOpenChange={() => {}}
    triggerRef={ref} trigger={<button ref={ref}>Резинки</button>}
    items={[
      { id: 'green', label: '2–5 кг', icon: 'tilde', iconColor: '#49DF7B',
        trailingAction: { icon: 'pencil', label: 'Изменить параметры', onSelect: () => {} } },
      { id: 'none', label: 'Без ленты', onSelect: () => {} },
    ]} />);
  const measure = view.container.querySelector('.ui-liquid-popover__measure');
  expect(measure).not.toBeNull();
  const withAction = measure?.querySelector('.ui-liquid-popover__item--with-action');
  expect(withAction?.querySelector('.ui-menu-item__label')?.textContent).toBe('2–5 кг');
  expect((withAction?.querySelector('.ui-menu-item__leading') as HTMLElement)?.style.color)
    .toBe('rgb(73, 223, 123)');
  expect(withAction?.querySelector('.ui-liquid-popover__trailing')).not.toBeNull();
  const ordinary = Array.from(measure?.children ?? [])
    .find(node => node.textContent === 'Без ленты');
  expect(ordinary?.classList.contains('ui-menu-item')).toBe(true);
});
