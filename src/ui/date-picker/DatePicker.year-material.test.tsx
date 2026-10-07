/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { type ElementType, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';

vi.mock('../GlassSurface', () => ({
  GlassSurface: ({
    component: Component = 'div',
    ref,
    preset,
    optics,
    shape: _shape,
    wrapContent: _wrapContent,
    className = '',
    children,
    ...props
  }: HTMLAttributes<HTMLElement> & {
    component?: ElementType;
    ref: Ref<HTMLElement>;
    preset: string;
    optics: boolean;
    shape?: string;
    wrapContent?: boolean;
    children?: ReactNode;
  }) => (
    <Component
      {...props}
      ref={ref}
      className={`ui-glass-surface ${className}`.trim()}
      data-preset={preset}
      data-optics={String(optics)}
    >
      {children}
    </Component>
  ),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('CanvasRenderingContext2D', undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DatePicker year material', () => {
  it('keeps trigger optics but forces the year LiquidPopover surface optics off', () => {
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DatePicker
            opened
            value="2026-09-25"
            onChange={() => {}}
            onClose={() => {}}
            glassPreset="smoked"
            glassOptics
          />
        </div>
      </KonstaProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Выбрать год, сейчас 2026' });
    const triggerSurface = trigger.closest<HTMLElement>('.ui-date-picker__year-trigger');
    expect(triggerSurface).toBe(trigger);
    expect(triggerSurface?.getAttribute('data-preset')).toBe('smoked');
    expect(triggerSurface?.getAttribute('data-optics')).toBe('true');

    fireEvent.click(trigger);
    expect(trigger.style.visibility).toBe('hidden');

    const popover = screen.getByRole('dialog', { name: 'Выберите год' });
    const popoverSurface = popover.querySelector<HTMLElement>('.ui-liquid-popover__glass');
    expect(popoverSurface?.getAttribute('data-preset')).toBe('smoked');
    expect(popoverSurface?.getAttribute('data-optics')).toBe('false');
  });
});
