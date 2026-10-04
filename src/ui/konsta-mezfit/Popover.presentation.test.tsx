/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MezfitPopover } from './Popover';
import { GlassSurface } from '../GlassSurface';

afterEach(cleanup);

describe('MezfitPopover custom presentation contract', () => {
  it('portals owned content without adding a second glass surface', () => {
    const close = vi.fn();
    const { container } = render(
      <KonstaProvider theme="ios" dark>
        <MezfitPopover
          opened
          presentation="custom"
          portal
          onBackdropClick={close}
          aria-label="Custom"
          role="menu"
        >
          <GlassSurface preset="frosted" optics={false}>
            <button type="button">Action</button>
          </GlassSurface>
        </MezfitPopover>
      </KonstaProvider>,
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const menu = screen.getByRole('menu', { name: 'Custom' });
    expect(menu.querySelectorAll('.ui-glass-surface').length).toBe(1);
    expect(menu.classList.contains('ui-mezfit-popover-custom')).toBe(true);
    // The backdrop is this wrapper's public dismissal surface, not a Radix layer.
    fireEvent.click(menu.previousElementSibling!);
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps the closed custom surface out of touch/accessibility interaction', () => {
    render(
      <KonstaProvider theme="ios" dark>
        <MezfitPopover
          opened={false}
          presentation="custom"
          portal
          role="menu"
          aria-label="Closed"
        >
          <button type="button">Action</button>
        </MezfitPopover>
      </KonstaProvider>,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('menu', { hidden: true }).hidden).toBe(true);
  });
});
