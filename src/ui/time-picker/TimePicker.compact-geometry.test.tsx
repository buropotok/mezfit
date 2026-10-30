// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumPicker } from '../num-picker/NumPicker';
import { TimePicker } from './TimePicker';
import { projectCylinder } from './cylinderProjection';

function wrap(node: ReactNode) {
  const target = document.createElement('button');
  document.body.appendChild(target);
  render(
    <KonstaProvider theme="ios" dark>
      <div className="k-ios dark">{node}</div>
    </KonstaProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('TimePicker compact optical geometry', () => {
  it('renders one finite cycle of hours and minutes', () => {
    wrap(<TimePicker opened target={document.body} value="08:15"
      onChange={vi.fn()} onClose={vi.fn()} lensMode="ios" />);
    const dialog = screen.getByRole('dialog', { name: 'Выбор времени' });
    expect(dialog.classList.contains('ui-time-picker__popover--compact-time')).toBe(true);
    expect(dialog.style.width).toBe('270px');

    const hours = screen.getByRole('listbox', { name: 'Часы' });
    const minutes = screen.getByRole('listbox', { name: 'Минуты' });
    expect(hours.querySelectorAll('button')).toHaveLength(24);
    expect(minutes.querySelectorAll('button')).toHaveLength(60);
    expect(within(hours).getAllByRole('option')).toHaveLength(24);
    expect(within(minutes).getAllByRole('option')).toHaveLength(60);
    expect(within(hours).getByRole('option', { name: '08' }).getAttribute('aria-selected')).toBe('true');
    expect(within(minutes).getByRole('option', { name: '15' }).getAttribute('aria-selected')).toBe('true');
  });

  it('projects the same cylinder into the lens with its existing optical scale', () => {
    wrap(<TimePicker opened target={document.body} value="08:15"
      onChange={vi.fn()} onClose={vi.fn()} lensMode="ios" />);
    const lens = document.querySelector('.ui-time-picker__lens');
    const source = lens?.querySelector('svg');
    expect(source?.getAttribute('viewBox')).toBe('0 0 288 72');

    const texts = Array.from(lens?.querySelectorAll('.ui-time-picker__lens-text') ?? []);
    const hour = (label: string) => texts.find(element =>
      element.textContent === label && element.getAttribute('x') === '62');
    expect(Number(hour('07')?.getAttribute('y'))).toBeCloseTo(36 + projectCylinder(-36)!.y * 2);
    expect(hour('08')?.getAttribute('y')).toBe('36');
    expect(Number(hour('09')?.getAttribute('y'))).toBeCloseTo(36 + projectCylinder(36)!.y * 2);
    // The source glyph compensation stays within the vertically scaled capsule.
    expect(hour('08')?.getAttribute('transform')).toContain('scale(1.55 3.1)');
    const separator = lens?.querySelector('.ui-time-picker__lens-separator');
    expect(separator?.getAttribute('transform')).toContain('scale(1.55 3.1)');
  });

  it('renders a pointer-transparent cylinder and resolves taps against projected rows', () => {
    const onChange = vi.fn();
    wrap(<TimePicker opened target={document.body} value="08:15"
      onChange={onChange} onClose={vi.fn()} lensMode="ios" />);
    const dialog = screen.getByRole('dialog', { name: 'Выбор времени' });
    expect(dialog.classList.contains('ui-time-picker__popover--cylinder')).toBe(true);
    expect(dialog.querySelector('.ui-time-picker__cylinder')?.getAttribute('aria-hidden')).toBe('true');
    const hours = screen.getByRole('listbox', { name: 'Часы' });
    vi.spyOn(hours, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 240 } as DOMRect);
    const y = 100 + 120 + projectCylinder(3 * 36)!.y;
    // The flat native hit row differs from the projected row under this point.
    fireEvent.click(within(hours).getByRole('option', { name: '10' }), { detail: 1, clientY: y });
    expect(onChange).toHaveBeenLastCalledWith('11:15');
  });

  it('uses the same cylindrical geometry for the single-column NumPicker', () => {
    wrap(<NumPicker opened target={document.body} value={207}
      onChange={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Выбор числа' });
    expect(dialog.classList.contains('ui-time-picker__popover--compact-time')).toBe(true);
    expect(dialog.querySelector('.ui-time-picker__cylinder')).not.toBeNull();
    const lower = screen.getByRole('listbox', { name: 'Число' });
    expect(lower.querySelectorAll('button')).toHaveLength(1000);
    expect(within(lower).getByRole('option', { name: '207' }).getAttribute('aria-selected')).toBe('true');
  });
});
