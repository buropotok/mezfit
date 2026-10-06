/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KonstaProvider, Range as KonstaRange } from 'konsta/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MezfitSlider, type MezfitSliderSize } from './Slider';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSlider(
  size: MezfitSliderSize,
  start = 0,
  end = 100,
  onValueChange = vi.fn(),
) {
  return {
    onValueChange,
    ...render(
      <KonstaProvider theme="ios" dark>
        <MezfitSlider
          size={size}
          start={start}
          end={end}
          onValueChange={onValueChange}
        />
      </KonstaProvider>,
    ),
  };
}

describe('MezfitSlider', () => {
  it('keeps the Konsta Range native input mechanics', () => {
    const konsta = render(
      <KonstaProvider theme="ios" dark>
        <KonstaRange min={0} max={100} value={0} onInput={() => {}} />
      </KonstaProvider>,
    );
    const mezfit = renderSlider('big');

    const konstaInput = konsta.container.querySelector<HTMLInputElement>('input[type="range"]');
    const mezfitInput = mezfit.container.querySelector<HTMLInputElement>('input[type="range"]');

    expect(konstaInput).not.toBeNull();
    expect(mezfitInput).not.toBeNull();
    expect(mezfitInput?.className).toBe(konstaInput?.className);
    expect(mezfit.container.querySelector('.k-range.mezfit-slider__input-layer')).not.toBeNull();
  });

  it.each([
    ['big', '330px', '60px', '21px', '90px', '60px'],
    ['medium', '247.5px', '45px', '15.75px', '67.5px', '45px'],
    ['small', '165px', '30px', '10.5px', '45px', '30px'],
  ] as const)(
    'scales the %s geometry proportionally',
    (size, width, height, trackHeight, thumbWidth, thumbHeight) => {
      const view = renderSlider(size);
      const root = view.container.querySelector<HTMLElement>('.mezfit-slider');

      expect(root?.style.getPropertyValue('--mezfit-slider-width')).toBe(width);
      expect(root?.style.getPropertyValue('--mezfit-slider-height')).toBe(height);
      expect(root?.style.getPropertyValue('--mezfit-slider-track-height')).toBe(trackHeight);
      expect(root?.style.getPropertyValue('--mezfit-slider-thumb-width')).toBe(thumbWidth);
      expect(root?.style.getPropertyValue('--mezfit-slider-thumb-height')).toBe(thumbHeight);
    },
  );

  it('starts at Start and emits Value continuously from the Konsta range input', () => {
    const view = renderSlider('big', 10, 20);
    const input = view.container.querySelector<HTMLInputElement>('input[type="range"]');
    const root = view.container.querySelector<HTMLElement>('.mezfit-slider');
    const fill = view.container.querySelector<HTMLElement>('.mezfit-slider__fill');

    expect(input?.min).toBe('10');
    expect(input?.max).toBe('20');
    expect(input?.value).toBe('10');
    expect(root?.dataset.value).toBe('10');

    fireEvent.input(input!, { target: { value: '15' } });

    expect(view.onValueChange).toHaveBeenLastCalledWith(15);
    expect(root?.dataset.value).toBe('15');
    expect(fill?.style.width).toBe('50%');
  });

  it('keeps a static Start/End value disabled without exposing Konsta zero-range math', () => {
    const view = renderSlider('small', 12, 12);
    const input = view.container.querySelector<HTMLInputElement>('input[type="range"]');
    const root = view.container.querySelector<HTMLElement>('.mezfit-slider');

    expect(input?.disabled).toBe(true);
    expect(input?.min).toBe('12');
    expect(input?.value).toBe('12');
    expect(root?.dataset.value).toBe('12');

    expect(view.onValueChange).not.toHaveBeenCalled();
    expect(root?.dataset.value).toBe('12');
  });

  it.each([
    ['big', 1, '3px', '14px'],
    ['medium', 0.75, '2.25px', '10.5px'],
    ['small', 0.5, '1.5px', '7px'],
  ] as const)(
    'scales %s shadow and optical displacement with the component geometry',
    (size, scale, shadowY, shadowBlur) => {
      const view = renderSlider(size);
      const root = view.container.querySelector<HTMLElement>('.mezfit-slider');
      const displacement = view.container.querySelector<SVGFEDisplacementMapElement>(
        '[data-mezfit-slider-displacement="true"]',
      );

      expect(root?.style.getPropertyValue('--mezfit-slider-shadow-y')).toBe(shadowY);
      expect(root?.style.getPropertyValue('--mezfit-slider-shadow-blur')).toBe(shadowBlur);
      expect(Number(displacement?.getAttribute('scale'))).toBeCloseTo(
        83.88118841653394 * scale * 0.4,
        8,
      );
    },
  );

  it('keeps the Kube optical chain private and switches refraction on press', () => {
    const view = renderSlider('big');
    const root = view.container.querySelector<HTMLElement>('.mezfit-slider');
    const filter = view.container.querySelector('filter');
    const displacement = view.container.querySelector<SVGFEDisplacementMapElement>(
      '[data-mezfit-slider-displacement="true"]',
    );
    const images = view.container.querySelectorAll('feImage');

    expect(filter).not.toBeNull();
    expect(filter?.querySelectorAll('feGaussianBlur')).toHaveLength(1);
    expect(filter?.querySelectorAll('feColorMatrix')).toHaveLength(1);
    expect(filter?.querySelectorAll('feComposite')).toHaveLength(1);
    expect(filter?.querySelectorAll('feComponentTransfer')).toHaveLength(1);
    expect(filter?.querySelectorAll('feBlend')).toHaveLength(2);
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
    expect(images[1]?.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
    expect(Number(displacement?.getAttribute('scale'))).toBeCloseTo(83.88118841653394 * 0.4, 8);

    fireEvent.pointerDown(root!);
    expect(Number(displacement?.getAttribute('scale'))).toBeCloseTo(83.88118841653394 * 0.9, 8);
    expect(view.container.querySelector('.mezfit-slider__thumb-layout.is-active')).not.toBeNull();

    fireEvent.pointerUp(root!);
    expect(Number(displacement?.getAttribute('scale'))).toBeCloseTo(83.88118841653394 * 0.4, 8);
  });

  it('uses an independent SVG filter id for each slider instance', () => {
    const view = render(
      <KonstaProvider theme="ios" dark>
        <>
          <MezfitSlider size="big" start={0} end={100} />
          <MezfitSlider size="small" start={0} end={100} />
        </>
      </KonstaProvider>,
    );

    const ids = Array.from(view.container.querySelectorAll('filter')).map(filter => filter.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
