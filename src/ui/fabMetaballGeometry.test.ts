import { describe, expect, it } from 'vitest';
import { FAB_METABALL_STAGE_WIDTH, fabBezelHighlights, fabContour, fabFrame, fabGeometry, fabJoined, fabRupture, fabStageWidth } from './fabMetaballGeometry';

describe('FAB metaball invariants', () => {
  it.each([[180, 100], [100, 260], [400, 600]])('preserves full height, gap and recoil for independent widths %i/%i', (dayWidth, phaseWidth) => {
    const layout = { width: fabStageWidth(dayWidth, phaseWidth), sourceSize: 56, dayWidth, phaseWidth };
    const reference = { width: FAB_METABALL_STAGE_WIDTH, sourceSize: 56 };
    const rupture = fabRupture(layout);
    expect(rupture).toBeCloseTo(fabRupture(reference), 5);
    const initial = fabGeometry(0, layout);
    expect(initial.day.x).toBe(initial.phase.x);
    expect(initial.day.height).toBeCloseTo(11.2);
    const atRupture = fabFrame(rupture, layout, rupture);
    expect(atRupture.day.height).toBe(44);
    expect(atRupture.day.tailHeight).toBe(44);
    expect(atRupture.phase.height).toBe(44);
    const final = fabFrame(1, layout, rupture), nominal = fabGeometry(1, reference);
    expect(final.day.width).toBe(dayWidth);
    expect(final.phase.width).toBe(phaseWidth);
    expect(final.phase.x - phaseWidth / 2 - final.day.x - dayWidth / 2)
      .toBeCloseTo(nominal.phase.x - nominal.phase.width / 2 - nominal.day.x - nominal.day.width / 2);
    expect(final.day.x - dayWidth / 2).toBeCloseTo(5.5);
    expect(final.phase.x + phaseWidth / 2).toBe(layout.width);
    const peak = rupture + 45 / 450;
    expect(fabFrame(peak, layout, rupture).day.x - fabGeometry(peak, layout).day.x).toBeCloseTo(-5.5);
  });


  it('coincident sources have exactly the source FAB silhouette', () => {
    const g = fabGeometry(0, { width: 317, sourceSize: 56 });
    expect(g.day.height).toBeCloseTo(11.2);
    expect(g.day.x).toBe(g.phase.x);
    expect(fabContour(g)).toBe('M289,0H289A28,28 0 0 1 289,56H289A28,28 0 0 1 289,0Z');
  });

  it.each([FAB_METABALL_STAGE_WIDTH, 280, 288, 317])('both capsules reach 44 CSS px before rupture at stage width %i', width => {
    const layout = { width, sourceSize: 56 };
    const rupture = fabRupture(layout);
    expect(rupture).toBeGreaterThan(0);
    expect(rupture).toBeLessThan(0.86);
    const g = fabGeometry(rupture - 0.0001, layout, 10);
    expect(g.day.height).toBe(44);
    expect(g.day.tailHeight).toBe(44);
    expect(g.phase.height).toBe(44);
    expect(fabJoined(fabGeometry(1, layout))).toBe(false);
    const final = fabFrame(1, layout, rupture);
    expect(final.day.width).toBe(100);
    expect(final.phase.width).toBe(100);
    expect(final.day.x - final.day.width / 2).toBeGreaterThanOrEqual(0);
    expect(final.phase.x + final.phase.width / 2).toBe(width);
  });

  it('grows the leading edge ahead of the trailing edge', () => {
    const g = fabGeometry(0.4, { width: 317, sourceSize: 56 });
    expect(g.day.height).toBeGreaterThan(g.day.tailHeight);
    expect(g.day.height).toBeLessThan(44);
  });

  it('continues left after rupture and settles at the exact final positions', () => {
    const layout = { width: 317, sourceSize: 56 }, rupture = fabRupture(layout);
    const at = rupture + 45 / 450;
    const moving = fabFrame(at, layout, rupture), nominal = fabGeometry(at, layout);
    expect(moving.day.x - nominal.day.x).toBeCloseTo(-5.5);
    expect(fabFrame(rupture, layout, rupture).phase.x - fabGeometry(rupture, layout).phase.x).toBeCloseTo(-10);
    expect(fabFrame(1, layout, rupture)).toEqual(fabGeometry(1, layout));
  });
  it('carries the two source highlights onto the growing day and phase before rupture', () => {
    const layout = { width: FAB_METABALL_STAGE_WIDTH, sourceSize: 56 };
    const rupture = fabRupture(layout);
    const initial = fabBezelHighlights(fabFrame(0, layout, rupture), 0, rupture);
    expect(initial.map(p => p.opacity)).toEqual([1, 1, 0, 0]);
    const time = rupture - 0.01, g = fabFrame(time, layout, rupture);
    const patches = fabBezelHighlights(g, time, rupture);
    expect(patches.map(p => p.opacity)).toEqual([1, 1, 0, 0]);
    expect(patches[0].x).toBeGreaterThan(g.phase.x);
    expect(patches[0].y).toBeGreaterThan(g.phase.y);
    expect(patches[1].x).toBeLessThan(g.day.x);
    expect(patches[1].y).toBeLessThan(g.day.y);
  });

  it('forms only the new facing-corner highlights after rupture and follows recoil', () => {
    const layout = { width: FAB_METABALL_STAGE_WIDTH, sourceSize: 56 };
    const rupture = fabRupture(layout), time = rupture + 45 / 450;
    const g = fabFrame(time, layout, rupture);
    const patches = fabBezelHighlights(g, time, rupture);
    expect(patches[2].opacity).toBeGreaterThan(0);
    expect(patches[2].opacity).toBeLessThan(1);
    expect(patches[3].opacity).toBe(patches[2].opacity);
    expect(patches[2].x).toBeGreaterThan(g.day.x);
    expect(patches[2].y).toBeGreaterThan(g.day.y);
    expect(patches[3].x).toBeLessThan(g.phase.x);
    expect(patches[3].y).toBeLessThan(g.phase.y);
    const nominal = fabBezelHighlights(fabGeometry(time, layout), time, rupture);
    expect(patches[1].x - nominal[1].x).toBeCloseTo(-5.5);
    expect(fabBezelHighlights(fabFrame(1, layout, rupture), 1, rupture).every(p => p.opacity === 1)).toBe(true);
  });

});
