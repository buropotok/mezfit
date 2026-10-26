/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MezfitSlider } from './Slider';

afterEach(() => cleanup());

describe('controlled small MezfitSlider for RPE', () => {
  it('retains a saved RPE value and updates it without altering range mechanics', () => {
    const onValueChange = vi.fn();
    const view = render(<KonstaProvider theme="ios" dark>
      <MezfitSlider size="small" start={0} end={10} value={7}
        ariaLabel="RPE" onValueChange={onValueChange} />
    </KonstaProvider>);
    const slider = screen.getByRole('slider', { name: 'RPE' }) as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('10');
    expect(slider.value).toBe('7');
    expect(view.container.querySelector('.mezfit-slider')?.getAttribute('data-size')).toBe('small');
    fireEvent.input(slider, { target: { value: '8' } });
    expect(onValueChange).toHaveBeenCalledWith(8);
    view.rerender(<KonstaProvider theme="ios" dark>
      <MezfitSlider size="small" start={0} end={10} value={8}
        ariaLabel="RPE" onValueChange={onValueChange} />
    </KonstaProvider>);
    expect(slider.value).toBe('8');
  });

  it('accepts zero, does not emit unchanged values or auto-save on mounting', () => {
    const onValueChange = vi.fn();
    render(<KonstaProvider theme="ios" dark>
      <MezfitSlider size="small" start={0} end={10} value={0}
        ariaLabel="RPE" onValueChange={onValueChange} />
    </KonstaProvider>);
    const slider = screen.getByRole('slider', { name: 'RPE' }) as HTMLInputElement;
    expect(slider.value).toBe('0');
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.input(slider, { target: { value: '0' } });
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.input(slider, { target: { value: '10' } });
    expect(onValueChange).toHaveBeenCalledWith(10);
  });
});
