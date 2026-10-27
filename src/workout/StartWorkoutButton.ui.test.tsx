// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlassSurfaceProps } from '../ui/GlassSurface';
import { StartWorkoutButton } from './StartWorkoutButton';

vi.mock('../ui', async () => {
  const { createElement } = await import('react');
  return {
    GlassSurface: ({ component, className, shape, preset, glass, children, onClick, 'aria-disabled': disabled }: GlassSurfaceProps) =>
      createElement(component ?? 'div', { className, onClick, 'aria-disabled': disabled,
        'data-shape': shape, 'data-preset': preset, 'data-tint': JSON.stringify(glass) }, children),
    Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
    Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  };
});
afterEach(cleanup);

describe('shared workout Start action', () => {
  it('uses the source-flow green glass capsule and a centered treadmill group', () => {
    const onClick = vi.fn();
    render(<StartWorkoutButton onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Начать тренировку' });
    expect(button.getAttribute('data-shape')).toBe('capsule');
    expect(button.getAttribute('data-preset')).toBe('modalTuned');
    expect(JSON.parse(button.getAttribute('data-tint') ?? '{}')).toEqual({ tintR: 155, tintG: 222, tintB: 175, tintA: 0.14 });
    expect(screen.getByTestId('icon-treadmill').parentElement?.className).toBe('start-workout-button__icon');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it('preserves native disabled behavior for pending and unavailable Starts', () => {
    const onClick = vi.fn();
    render(<StartWorkoutButton disabled onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Начать тренировку' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
