/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs, TabsList, TabsTrigger } from './index';

const iconPair = {
  outline: <span data-icon="outline" />,
  filled: <span data-icon="filled" />,
};

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function Example({ hidden }: { hidden: boolean }) {
  return (
    <Tabs defaultValue="one" mode="iconOnly" theme="liquidGlass" hidden={hidden}>
      <TabsList aria-label="Navigation">
        <TabsTrigger value="one" icon={iconPair}>One</TabsTrigger>
        <TabsTrigger value="two" icon={iconPair}>Two</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ cancel: vi.fn() })),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Liquid Glass iconOnly startup state', () => {
  it('stays hidden until hidden changes from true to false, then enters reveal state', () => {
    const { container, rerender } = render(<Example hidden />);

    const shell = container.querySelector<HTMLElement>('.ui-tabs__icon-only-shell');
    expect(shell?.dataset.startupState).toBe('hidden');

    rerender(<Example hidden={false} />);
    expect(shell?.dataset.startupState).toBe('revealing');

    rerender(<Example hidden />);
    expect(shell?.dataset.startupState).toBe('hidden');
  });

  it('is immediately visible when mounted with hidden=false', () => {
    const { container } = render(<Example hidden={false} />);

    expect(container.querySelector<HTMLElement>('.ui-tabs__icon-only-shell')?.dataset.startupState).toBe('visible');
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });
});
