import { describe, expect, it } from 'vitest';
import { fabJoined } from './fabMetaballGeometry';
import {
  NAVBAR_METABALL,
  navbarMetaballContour,
  navbarMetaballFrame,
  navbarMetaballGeometry,
  navbarMetaballRupture,
} from './navbarMetaballGeometry';

describe('navbar metaball geometry', () => {
  const layout = { width: 390, identityWidth: 224 };

  it('parks Back exactly under the identity leading visual and ends at the navbar edge', () => {
    const hidden = navbarMetaballGeometry(0, layout);
    const visible = navbarMetaballGeometry(1, layout);
    const identityLeft = hidden.phase.x - hidden.phase.width / 2;

    expect(hidden.day.x).toBeCloseTo(identityLeft + NAVBAR_METABALL.backSize / 2);
    expect(hidden.day.width).toBe(NAVBAR_METABALL.backSize);
    expect(hidden.day.height).toBe(NAVBAR_METABALL.backSize);
    expect(visible.day.x).toBe(NAVBAR_METABALL.backSize / 2);
    expect(visible.phase).toEqual(hidden.phase);
  });

  it('starts as one joined identity silhouette and ruptures before the final Back position', () => {
    const hidden = navbarMetaballGeometry(0, layout);
    const visible = navbarMetaballGeometry(1, layout);
    const rupture = navbarMetaballRupture(layout);

    expect(navbarMetaballContour(hidden)).not.toBe('');
    expect(fabJoined(hidden)).toBe(true);
    expect(rupture).toBeGreaterThan(0);
    expect(rupture).toBeLessThan(1);
    expect(fabJoined(visible)).toBe(false);
  });

  it('uses the new FAB-style recoil and settles to the exact same path in either direction', () => {
    const rupture = navbarMetaballRupture(layout);
    const time = rupture + 45 / NAVBAR_METABALL.duration;
    const moving = navbarMetaballFrame(time, layout, rupture);
    const nominal = navbarMetaballGeometry(time, layout);

    expect(moving.day.x - nominal.day.x).toBeCloseTo(-NAVBAR_METABALL.backRecoil);
    expect(navbarMetaballFrame(1, layout, rupture)).toEqual(navbarMetaballGeometry(1, layout));
    expect(navbarMetaballFrame(0, layout, rupture)).toEqual(navbarMetaballGeometry(0, layout));
  });
});
