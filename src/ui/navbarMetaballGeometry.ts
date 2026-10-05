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
  backRecoil: FAB_METABALL.dayRecoil,
  bezelRevealDuration: 120,
});

export type NavbarMetaballLayout = {
  width: number;
  identityWidth: number;
};

export const navbarIdentityWidth = (width: number) => (
  Math.max(NAVBAR_METABALL.backSize, Math.min(224, width - 164))
);

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
  // Match the FAB day-lobe scale-in: keep a small seed under the source,
  // then grow the leading edge ahead of the trailing edge before rupture.
  const backSeparation = Math.max(0, sourceX - backX);
  const initialBackSize = size * 0.2;
  const growthStart = (size + initialBackSize) / 2;
  const growthEnd = size - initialBackSize * 0.6;
  const backGrowth = Math.max(0, Math.min(1, (backSeparation - growthStart) / (growthEnd - growthStart)));
  const growthExponent = 1 + FAB_METABALL.dropLead * 2;
  const backHeight = initialBackSize + (size - initialBackSize) * (1 - (1 - backGrowth) ** growthExponent);
  const backTailHeight = initialBackSize + (size - initialBackSize) * backGrowth ** growthExponent;
  const backWidth = Math.max(
    initialBackSize + (size - initialBackSize) * backGrowth,
    backHeight,
  );

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
      width: backWidth,
      height: backHeight,
      tailHeight: backTailHeight,
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
