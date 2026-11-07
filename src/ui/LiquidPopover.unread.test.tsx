// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LiquidPopover } from './LiquidPopover';
afterEach(cleanup);

it('measures a semantic superscript for entity unread and removes it when read', () => {
  const ref = createRef<HTMLButtonElement>();
  const page = (unreadCount: number) => <LiquidPopover isOpen={false} onOpenChange={() => {}}
    triggerRef={ref} trigger={<button ref={ref}>…</button>}
    items={[{ id: 'discussions', label: 'Обсуждения', unreadCount }]} />;
  const view = render(page(12));
  const count = view.container.querySelector('.ui-liquid-popover__measure sup');
  expect(count?.getAttribute('aria-label')).toBe('Непрочитанных: 12');
  expect(count?.querySelector('.ui-text--caption')?.textContent).toBe('12');
  view.rerender(page(0));
  expect(view.container.querySelector('sup')).toBeNull();
});
