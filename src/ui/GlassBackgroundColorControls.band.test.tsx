// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { KonstaProvider } from 'konsta/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GlassBackgroundColorControls } from './GlassBackgroundColorControls';

afterEach(() => cleanup());

it('uses an opt-in band wheel label and stacked layout without changing default behavior', () => {
  const onChange = vi.fn();
  const first = render(<KonstaProvider theme="ios" dark>
    <GlassBackgroundColorControls color={{ hue: 150, saturation: 50, value: 80 }}
      onChange={onChange} stacked colorSubject="ленты" />
  </KonstaProvider>);
  expect(screen.getByRole('button', { name: /Выбрать цвет ленты/ })).toBeTruthy();
  expect(first.container.querySelector('.glass-background-lab__controls--stacked')).not.toBeNull();
  first.unmount();
  render(<KonstaProvider theme="ios" dark>
    <GlassBackgroundColorControls color={{ hue: 150, saturation: 50, value: 80 }}
      onChange={onChange} />
  </KonstaProvider>);
  expect(screen.getByRole('button', { name: /Выбрать цвет фона/ })).toBeTruthy();
});
