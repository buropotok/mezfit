import {
  FAB_METABALL,
  fabBezelHighlights,
  fabContour,
  fabJoined,
  smoothFab,
  type FabGeometry,
} from './fabMetaballGeometry';

export const NAVBAR_METABALL = Object.freeze({
  duration: FAB_METABALL.duration,
  backSize: 44,
  backRecoil: 4,
  bezelRevealDuration: 120,
});

export type NavbarMetaballLayout = {
  width: number;
  identityWidth: number;
};

const clampIdentityWidth = (layout: NavbarMetaballLayout) => (
  Math.max(NAVBAR_METABALL.backSize, Math.min(layout.identityWidth, layout.width))
);

export function navbarMetaballGeometry(
  time: number,
  layout: NavbarMetaballLayout,
  backShift = 0,
): FabGeometry {
  const size = NAVBAR_METABALL.backSize;
  const identityWidth = clampIdentityWidth(layout);
  const y = size / 2;
  const identityX = layout.width / 2 - size / 2;
  const identityLeft = identityX - identityWidth / 2;
  const sourceX = identityLeft + size / 2;
  const finalX = size / 2;
  const travel = smoothFab(time / 0.86);
  const backX = sourceX + (finalX - sourceX) * travel + backShift;

  return {
    base: { x: sourceX, y },
    phase: {
      x: identityX,
      y,
      width: identityWidth,
      height: size,
      tailHeight: size,
    },
    day: {
      x: backX,
      y,
      width: size,
      height: size,
      tailHeight: size,
    },
  };
}

export function navbarMetaballRupture(layout: NavbarMetaballLayout) {
  let lo = 0;
  let hi = 1;
  const joined = (time: number) => fabJoined(navbarMetaballGeometry(time, layout));

  for (let index = 1; index <= 120; index += 1) {
    const time = index / 120;
    if (!joined(time)) {
      lo = (index - 1) / 120;
      hi = time;
      break;
    }
  }

  for (let index = 0; index < 16; index += 1) {
    const middle = (lo + hi) / 2;
    if (joined(middle)) lo = middle;
    else hi = middle;
  }

  return hi;
}

export function navbarMetaballFrame(
  time: number,
  layout: NavbarMetaballLayout,
  rupture: number,
) {
  const dt = Math.max(0, (time - rupture) * NAVBAR_METABALL.duration / 1000);
  const finish = 1 - smoothFab((time - 0.96) / 0.04);
  const backShift = time < rupture
    ? 0
    : -NAVBAR_METABALL.backRecoil * (dt / 0.045) * Math.exp(1 - dt / 0.045) * finish;

  return navbarMetaballGeometry(time, layout, backShift);
}

export function navbarBackReveal(time: number, rupture: number) {
  return smoothFab((time - rupture) / 0.12);
}

export function navbarMetaballContour(geometry: FabGeometry) {
  return fabContour(geometry);
}

export function navbarMetaballBezelHighlights(
  geometry: FabGeometry,
  time: number,
  rupture: number,
) {
  return fabBezelHighlights(geometry, time, rupture);
}
