import { describe, expect, it } from 'vitest';
import { FAB_METABALL, fabJoined } from './fabMetaballGeometry';
import {
  NAVBAR_METABALL,
  navbarBackReveal,
  navbarIdentityWidth,
  navbarMetaballContour,
  navbarMetaballFrame,
  navbarMetaballGeometry,
  navbarMetaballRupture,
} from './navbarMetaballGeometry';

describe('navbar metaball geometry', () => {
  const layout = { width: 390, identityWidth: navbarIdentityWidth(390) };

  it('inherits the current FAB timing/recoil and responds to navbar width', () => {
    expect(NAVBAR_METABALL.duration).toBe(FAB_METABALL.duration);
    expect(NAVBAR_METABALL.backRecoil).toBe(FAB_METABALL.dayRecoil);
    expect(navbarIdentityWidth(320)).toBe(156);
    expect(navbarIdentityWidth(390)).toBe(224);
    expect(navbarIdentityWidth(600)).toBe(224);
  });

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

  it('keeps Back content fully hidden until the glass contour has ruptured', () => {
    const rupture = navbarMetaballRupture(layout);

    expect(navbarBackReveal(0, rupture)).toBe(0);
    expect(navbarBackReveal(rupture - 0.0001, rupture)).toBe(0);
    expect(navbarBackReveal(rupture, rupture)).toBe(0);
    expect(navbarBackReveal(rupture + 0.12, rupture)).toBe(1);
    expect(navbarBackReveal(1, rupture)).toBe(1);
  });

  it('uses the FAB recoil and settles to the exact same endpoints in either direction', () => {
    const rupture = navbarMetaballRupture(layout);
    const time = rupture + 45 / NAVBAR_METABALL.duration;
    const moving = navbarMetaballFrame(time, layout, rupture);
    const nominal = navbarMetaballGeometry(time, layout);

    expect(moving.day.x - nominal.day.x).toBeCloseTo(-NAVBAR_METABALL.backRecoil);
    expect(navbarMetaballFrame(1, layout, rupture)).toEqual(navbarMetaballGeometry(1, layout));
    expect(navbarMetaballFrame(0, layout, rupture)).toEqual(navbarMetaballGeometry(0, layout));
  });
});
