// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { ClientExerciseStatisticsView } from './ClientExerciseStatisticsView';

vi.mock('../ui', () => ({
  GlassSurface: ({ children, className, contentClassName, shape, wrapContent }: {
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    shape?: 'auto' | 'capsule' | { radius: number };
    wrapContent?: boolean;
  }) => <section className={className}
    data-shape={shape === undefined ? 'auto' : typeof shape === 'object' ? 'custom' : shape}
    data-mode={wrapContent === false ? 'host' : 'standalone'}>
    <div className={contentClassName}>{children}</div>
  </section>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  LiquidPopover: () => null,
  IconButton: () => null,
}));
vi.mock('../ui/Charts', () => ({ MezfitLineChart: () => null }));

afterEach(cleanup);

it('uses automatic GlassSurface geometry and public content layout on chart and tiles', () => {
  const { container } = render(<ClientExerciseStatisticsView facts={[]} trackingType="weight_reps" />);
  const tiles = container.querySelectorAll('.client-exercises__metric-tile');
  expect(tiles).toHaveLength(8);
  const chart = container.querySelector('.client-exercises__chart-panel');
  expect(chart?.querySelector('.client-exercises__panel-content')).not.toBeNull();
  for (const surface of [...tiles, ...(chart ? [chart] : [])]) {
    expect(surface.getAttribute('data-shape')).toBe('auto');
    expect(surface.getAttribute('data-mode')).toBe('standalone');
  }
  for (const tile of tiles) {
    expect(tile.querySelector('.client-exercises__metric-content')).not.toBeNull();
  }
});
