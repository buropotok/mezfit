// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramToolbar } from './ProgramToolbar';

vi.mock('../ui', () => ({
  IconButton: () => null,
  MezfitSearchbar: () => null,
  Text: () => null,
}));

vi.mock('../ui/LiquidGlassTextOnly', () => ({
  LiquidGlassTextOnly: ({ glassPreset }: { glassPreset?: string }) => (
    <span data-testid="program-glass-preset" data-preset={glassPreset} />
  ),
}));

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('mezfit.glassSettings');
});

describe('ProgramToolbar glass preferences', () => {
  it('passes the selected application preset to production tabs', () => {
    const controls = {
      filter: 'all' as const,
      onFilterChange: vi.fn(),
      search: '',
      onSearchChange: vi.fn(),
    };
    window.localStorage.setItem('mezfit.glassSettings', JSON.stringify({
      preset: 'frosted', blur: 14, optics: false,
    }));
    const view = render(<ProgramToolbar controls={controls} showSearch={false} />);
    expect(screen.getByTestId('program-glass-preset').getAttribute('data-preset')).toBe('frosted');

    window.localStorage.setItem('mezfit.glassSettings', JSON.stringify({
      preset: 'clear', blur: 2, optics: true,
    }));
    view.rerender(<ProgramToolbar controls={controls} showSearch={false} />);
    expect(screen.getByTestId('program-glass-preset').getAttribute('data-preset')).toBe('clear');
  });
});
