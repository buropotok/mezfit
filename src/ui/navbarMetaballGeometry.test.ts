import { describe, expect, it } from 'vitest';
import { FAB_METABALL, fabJoined } from './fabMetaballGeometry';
import {
  NAVBAR_METABALL,
  navbarBackReveal,
  navbarIdentityWidth,
  navbarMetaballBezelHighlights,
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
    expect(hidden.day.width).toBeCloseTo(NAVBAR_METABALL.backSize * 0.2);
    expect(hidden.day.height).toBeCloseTo(NAVBAR_METABALL.backSize * 0.2);
    expect(visible.day.x).toBe(NAVBAR_METABALL.backSize / 2);
    expect(visible.day.width).toBe(NAVBAR_METABALL.backSize);
    expect(visible.day.height).toBe(NAVBAR_METABALL.backSize);
    expect(visible.phase).toEqual(hidden.phase);
  });

  it('grows Back with the FAB leading-edge profile before rupture', () => {
    const hidden = navbarMetaballGeometry(0, layout);
    const growing = navbarMetaballGeometry(0.45, layout);
    const rupture = navbarMetaballRupture(layout);
    const beforeRupture = navbarMetaballGeometry(rupture - 0.0001, layout);

    expect(growing.day.width).toBeGreaterThan(hidden.day.width);
    expect(growing.day.width).toBeLessThan(NAVBAR_METABALL.backSize);
    expect(growing.day.height).toBeGreaterThan(growing.day.tailHeight);
    expect(beforeRupture.day.width).toBe(NAVBAR_METABALL.backSize);
    expect(beforeRupture.day.height).toBe(NAVBAR_METABALL.backSize);
    expect(beforeRupture.day.tailHeight).toBe(NAVBAR_METABALL.backSize);
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

  it('leaves stationary IdentityAction bezel highlights owned by the identity surface', () => {
    const rupture = navbarMetaballRupture(layout);
    const initial = navbarMetaballBezelHighlights(
      navbarMetaballFrame(0, layout, rupture),
      0,
      rupture,
    );
    const growingTime = rupture * 0.75;
    const growing = navbarMetaballBezelHighlights(
      navbarMetaballFrame(growingTime, layout, rupture),
      growingTime,
      rupture,
    );
    const settled = navbarMetaballBezelHighlights(
      navbarMetaballFrame(1, layout, rupture),
      1,
      rupture,
    );

    expect(initial[0].opacity).toBe(0);
    expect(initial[1].opacity).toBe(0);
    expect(initial[3].opacity).toBe(0);
    expect(growing[0].opacity).toBe(0);
    expect(growing[1].opacity).toBeGreaterThan(0);
    expect(growing[3].opacity).toBe(0);
    expect(settled[0].opacity).toBe(0);
    expect(settled[1].opacity).toBe(1);
    expect(settled[2].opacity).toBe(1);
    expect(settled[3].opacity).toBe(0);
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
