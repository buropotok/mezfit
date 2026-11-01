// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { ClientExerciseStatisticsView } from './ClientExerciseStatisticsView';

vi.mock('../ui', () => ({
  GlassSurface: ({ children, className, shape }: {
    children: ReactNode; className?: string; shape?: { radius: number };
  }) => <section className={className} data-radius={shape?.radius}>{children}</section>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  LiquidPopover: () => null,
  IconButton: () => null,
}));
vi.mock('../ui/Charts', () => ({ MezfitLineChart: () => null }));

afterEach(cleanup);

it('sets the public rounded glass shape on the chart and metric tiles', () => {
  const { container } = render(<ClientExerciseStatisticsView facts={[]} trackingType="weight_reps" />);
  const tiles = container.querySelectorAll('.client-exercises__metric-tile');
  expect(tiles).toHaveLength(8);
  expect(container.querySelector('.client-exercises__chart-panel')?.getAttribute('data-radius')).toBe('16');
  for (const tile of tiles) expect(tile.getAttribute('data-radius')).toBe('16');
});
