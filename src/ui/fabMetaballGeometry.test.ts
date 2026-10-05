import { describe, expect, it } from 'vitest';
import { FAB_METABALL_STAGE_WIDTH, fabContour, fabFrame, fabGeometry, fabJoined, fabRupture } from './fabMetaballGeometry';

describe('FAB metaball invariants', () => {
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
});
