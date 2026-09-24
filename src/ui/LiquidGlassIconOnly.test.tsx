/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tabs, TabsList, TabsTrigger } from './index';
import { LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET } from './LiquidGlassIconOnlyInteraction';

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
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setLayout(container: HTMLElement) {
  const list = container.querySelector<HTMLElement>('.ui-tabs__list');
  const triggers = [...container.querySelectorAll<HTMLElement>('.ui-tabs__trigger')];
  if (!list) throw new Error('Tabs list is missing');

  Object.defineProperties(list, {
    clientWidth: { configurable: true, value: 200 },
    scrollWidth: { configurable: true, value: 200 },
    offsetWidth: { configurable: true, value: 200 },
  });
  list.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 64,
    width: 200,
    height: 64,
    toJSON: () => ({}),
  });

  triggers.forEach((trigger, index) => {
    Object.defineProperties(trigger, {
      offsetLeft: { configurable: true, value: index * 100 },
      offsetWidth: { configurable: true, value: 100 },
    });
  });

  return list;
}

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
  it('keeps the approved interaction timings from the prototype', () => {
    expect(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.holdDelayMs).toBe(140);
    expect(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.lensTravelMs).toBe(300);
    expect(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.containerScale).toBe(1.05);
    expect(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring.durationMs).toBe(600);
    expect(LIQUID_GLASS_ICON_ONLY_INTERACTION_PRESET.spring.leadMs).toBe(90);
  });

  it('shows the lens, glass highlight and enlarged container after a long hold', () => {
    const { container } = render(<Example hidden={false} />);
    const list = setLayout(container);
    const lens = container.querySelector<HTMLElement>('.ui-tabs__icon-only-lens');

    fireEvent.pointerDown(list, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 25,
      clientY: 32,
    });
    vi.advanceTimersByTime(140);

    expect(lens?.classList.contains('pressed')).toBe(true);
    expect(list.style.scale).toBe('1.05');
    expect(list.querySelector('.ui-tabs__icon-only-glass-light-wrap')).not.toBeNull();
  });

  it('enlarges the container immediately while the lens travels to another tab', () => {
    const { container } = render(<Example hidden={false} />);
    const list = setLayout(container);

    fireEvent.pointerDown(list, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 25,
      clientY: 32,
    });
    fireEvent.pointerUp(list, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 175,
      clientY: 32,
    });

    expect(list.style.scale).toBe('1.05');
    expect(container.querySelector('.ui-tabs__icon-only-lens.tap-spring-active')).not.toBeNull();
    expect(container.querySelector('.ui-tabs__active-indicator-surface.tap-spring-hidden')).not.toBeNull();
  });

});
