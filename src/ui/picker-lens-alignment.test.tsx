// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DistancePicker } from './distance-picker/DistancePicker';
import { TimePicker } from './time-picker/TimePicker';
import { centeredLensScale } from './time-picker/centeredLensScale';
import { buildTimeLensVectorFields } from './time-picker/timePickerLens';
import { DurationPicker } from './duration-picker/DurationPicker';
import { WeightRepsPicker } from './weight-reps-picker/WeightRepsPicker';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('picker lens numeric alignment', () => {
  it.each([
    [[62, 226]],
    [[48, 144, 240]],
    [[80, 176, 240]],
  ])('zooms each Android SVG column without moving its numeric center (%j)', (centers) => {
    const { zoom } = buildTimeLensVectorFields({ includeSpecular: false, zoomCenters: centers });
    const redAt = (x: number, y = 36) => {
      const px = Math.floor(x * zoom.width / 288);
      const py = Math.floor(y * zoom.height / 72);
      return zoom.pixels[(py * zoom.width + px) * 4];
    };
    for (const x of centers) {
      expect(Math.abs(redAt(x) - 128)).toBeLessThanOrEqual(1);
      expect(redAt(x - 8)).toBeGreaterThan(128);
      expect(redAt(x + 8)).toBeLessThan(128);
    }
    for (let index = 1; index < centers.length; index += 1) {
      const midpoint = (centers[index - 1] + centers[index]) / 2;
      expect(Math.abs(redAt(midpoint) - 128)).toBeLessThanOrEqual(1);
    }
  });
  it.each([
    [48, 36, 1.55],
    [62, 36, 1.55],
    [80, 36, 1.55],
    [176, 36, 1.55],
    [226, 36, 1.55],
    [240, 36, 1.55],
    [62, 12, 1.1],
  ])('keeps SVG magnification anchored at (%i, %i) with factor %s', (x, y, scale) => {
    const transform = centeredLensScale(x, y, scale);
    const match = transform.match(/^translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\) translate\(([^ ]+) ([^)]+)\)$/);
    expect(match).not.toBeNull();
    const [pivotX, pivotY, factor, inverseX, inverseY] = match!.slice(1).map(Number);
    expect(factor).toBe(scale);
    expect(pivotX + factor * (x + inverseX)).toBeCloseTo(x);
    expect(pivotY + factor * (y + inverseY)).toBeCloseTo(y);
  });

  it('places two-wheel numeric lens centers on the actual CSS grid columns', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <TimePicker opened value="12:34" onChange={vi.fn()} onClose={vi.fn()} target={target} lensMode="ios" />
        </div>
      </KonstaProvider>,
    );

    const texts = Array.from(document.querySelectorAll('.ui-time-picker__lens-text'));
    const hours = texts.find((element) => element.textContent === '12');
    const minutes = texts.find((element) => element.textContent === '34');
    expect(hours?.getAttribute('x')).toBe('62');
    expect(minutes?.getAttribute('x')).toBe('226');
    expect(hours?.getAttribute('transform')).toContain('scale(1.55)');
    expect(minutes?.getAttribute('transform')).toContain('scale(1.55)');
  });

  it('keeps distance units stationary in the lens, outside the numeric scroll ribbons', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DistancePicker opened value={39058} onChange={vi.fn()} onClose={vi.fn()} target={target} />
        </div>
      </KonstaProvider>,
    );
    const km = screen.getByRole('listbox', { name: 'Километры' });
    const m = screen.getByRole('listbox', { name: 'Метры' });
    expect(within(km).getByRole('option', { name: '39 км' }).textContent).toBe('39');
    expect(within(m).getByRole('option', { name: '058 м' }).textContent).toBe('058');
    expect(within(km).getAllByRole('option').every(item => !item.textContent?.includes('км'))).toBe(true);
    expect(within(m).getAllByRole('option').every(item => !item.textContent?.includes('м'))).toBe(true);
    const labels = Array.from(document.querySelectorAll('.ui-time-picker__lens-unit'));
    expect(labels.map(node => node.textContent)).toEqual(['км', 'м']);
    expect(labels.map(node => node.getAttribute('x'))).toEqual(['98', '262']);
    const lensTexts = Array.from(document.querySelectorAll('.ui-time-picker__lens-text'));
    expect(lensTexts.some(node => node.textContent === '39' && node.getAttribute('x') === '62')).toBe(true);
    expect(lensTexts.some(node => node.textContent === '058' && node.getAttribute('x') === '226')).toBe(true);
  });

  it('preserves duration wheel alignment and the two static weight/reps lens action anchors', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    const ui = render(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <DurationPicker opened value={79204} onChange={vi.fn()} onClose={vi.fn()} target={target} />
        </div>
      </KonstaProvider>,
    );
    const texts = Array.from(document.querySelectorAll('.ui-time-picker__lens-text'));
    for (const x of ['48', '144', '240']) expect(texts.some(node => node.getAttribute('x') === x)).toBe(true);

    ui.rerender(
      <KonstaProvider theme="ios" dark>
        <div className="k-ios dark">
          <WeightRepsPicker opened value={{ reps: 8, weightKg: 77.5 }} onChange={vi.fn()} onClose={vi.fn()} target={target} />
        </div>
      </KonstaProvider>,
    );
    const updated = Array.from(document.querySelectorAll('.ui-time-picker__lens-text'));
    expect(updated).toHaveLength(3); // Previous, selected and next fractional values remain in the lens.
    expect(updated.every(node => node.getAttribute('x') === '240')).toBe(true);
    const slots = Array.from(document.querySelectorAll<HTMLElement>('.ui-time-picker__lens-action-slot'));
    expect(slots).toHaveLength(2);
    expect(Number.parseFloat(slots[0].style.left)).toBeCloseTo(80 / 288 * 100);
    expect(Number.parseFloat(slots[1].style.left)).toBeCloseTo(176 / 288 * 100);
    expect(screen.getByRole('button', { name: 'Изменить повторения' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Изменить целые килограммы' })).toBeTruthy();
  });
});
