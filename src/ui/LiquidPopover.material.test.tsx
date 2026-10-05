/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { createRef, type ReactNode, type Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiquidPopover } from './LiquidPopover';

vi.mock('./GlassSurface', () => ({
  GlassSurface: ({
    ref,
    preset,
    optics,
    className,
  }: {
    ref: Ref<HTMLDivElement>;
    preset: string;
    optics: boolean;
    className: string;
  }) => (
    <div
      ref={ref}
      className={className}
      data-testid="liquid-glass"
      data-preset={preset}
      data-optics={String(optics)}
    />
  ),
}));

vi.mock('./konsta-mezfit/Popover', () => ({
  MezfitPopover: ({
    opened,
    children,
    ref,
    role,
    'aria-label': ariaLabel,
    className,
    style,
  }: {
    opened: boolean;
    children: ReactNode;
    ref: Ref<HTMLDivElement>;
    role: string;
    'aria-label': string;
    className: string;
    style?: React.CSSProperties;
  }) => (
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={style}
      hidden={!opened}
    >
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LiquidPopover material and layout', () => {
  it('passes preset and optics to its GlassSurface and supports dialog grid layout', () => {
    vi.stubGlobal('CanvasRenderingContext2D', undefined);
    const triggerRef = createRef<HTMLButtonElement>();

    render(
      <LiquidPopover
        isOpen
        onOpenChange={() => {}}
        trigger={<button ref={triggerRef}>2026</button>}
        triggerRef={triggerRef}
        items={[
          { id: '2025', label: '2025' },
          { id: '2026', label: '2026', active: true, 'aria-current': 'date' },
        ]}
        label="Выберите год"
        preset="smoked"
        optics
        layout="grid"
        columns={4}
        role="dialog"
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Выберите год' }).className).toContain('ui-liquid-popover--grid');
    expect(screen.getByTestId('liquid-glass').getAttribute('data-preset')).toBe('smoked');
    expect(screen.getByTestId('liquid-glass').getAttribute('data-optics')).toBe('true');
    expect(screen.getByRole('button', { name: '2026' }).getAttribute('aria-current')).toBe('date');
  });
});
