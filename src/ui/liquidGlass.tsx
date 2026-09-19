import { useId } from 'react';

export type LiquidGlassGeometry = {
  width: number;
  height: number;
  radiusX: number;
  radiusY: number;
};

export const LIQUID_GLASS_TABS_PRESET = {
  containerMaxScalePercent: 105,
  lensHeightPercent: 125,
  lensAxisRatioHeightToWidth: 1.15,
  selectorTravelDurationMs: 440,
  keepInsideMarginPx: 3,
  swipeThresholdPx: 8,
  pressIntentDelayMs: 75,
  releaseDelayMs: 130,
  impactPointPercent: 39,
  containerSpring: {
    durationMs: 360,
    overshootPercent: 40,
    recoilPercent: 27,
  },
  iconSpring: {
    delayAfterImpactMs: 245,
    durationMs: 1010,
    overshootPercent: 38,
    recoilPercent: 22,
  },
  selectorSpring: {
    durationMs: 1360,
    firstHeightShrinkPercent: 16,
    firstWidthToHeightPercent: 100,
    secondWidthShrinkPercent: 11,
    secondHeightShrinkPercent: 3,
    firstSquashPointPercent: 18,
    firstReturnPointPercent: 52,
    secondSquashPointPercent: 64,
  },
} as const;

export function useLiquidGlassFilterId(prefix: string) {
  const reactId = useId().replace(/:/g, '');
  return `ui-${prefix}-${reactId}`;
}

export function liquidGlassFullLensSize(listHeight: number, selectorWidth: number, mode: 'default' | 'icon') {
  const height = listHeight * LIQUID_GLASS_TABS_PRESET.lensHeightPercent / 100;
  const ovalWidth = height / LIQUID_GLASS_TABS_PRESET.lensAxisRatioHeightToWidth;
  return {
    width: mode === 'default' ? Math.max(ovalWidth, selectorWidth + 6) : ovalWidth,
    height,
  };
}

export function liquidGlassDifferentTabProgress(
  elapsedMs: number,
  travelMs: number,
  isPressed: boolean,
  closeStartAtMs: number | null,
) {
  const half = travelMs / 2;
  if (elapsedMs < half) return Math.max(0, Math.min(1, elapsedMs / half));
  if (isPressed) return 1;
  if (closeStartAtMs === null || elapsedMs < closeStartAtMs) return 1;
  return Math.max(0, Math.min(1, 1 - (elapsedMs - closeStartAtMs) / half));
}

export function liquidGlassSameTabProgress(
  elapsedMs: number,
  travelMs: number,
  isPressed: boolean,
  progressAtRelease: number,
  closeStartAtMs: number | null,
) {
  const half = travelMs / 2;
  if (isPressed) return Math.max(0, Math.min(1, elapsedMs / half));
  if (closeStartAtMs === null || elapsedMs < closeStartAtMs) return progressAtRelease;
  return Math.max(0, Math.min(1, progressAtRelease - (elapsedMs - closeStartAtMs) / half));
}

function opticalMapSvg({ width, height, radiusX, radiusY }: LiquidGlassGeometry) {
  const sx = width / 420;
  const sy = height / 280;
  const insetX = Math.max(.5, 10 * sx);
  const insetY = Math.max(.5, 10 * sy);
  const blurOuter = Math.max(.15, 2 * sy);
  const blurInner = Math.max(.5, 10 * sy);
  const innerWidth = Math.max(1, width - insetX * 2);
  const innerHeight = Math.max(1, height - insetY * 2);
  const innerRx = Math.max(1, radiusX - insetX);
  const innerRy = Math.max(1, radiusY - insetY);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="Y" x1="0" x2="0" y1="6%" y2="94%">
      <stop offset="0%" stop-color="#00ff00"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="X" x1="4%" x2="96%" y1="0" y2="0">
      <stop offset="0%" stop-color="#ff0000"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
    <filter id="O"><feGaussianBlur stdDeviation="${blurOuter}"/></filter>
    <filter id="I"><feGaussianBlur stdDeviation="${blurInner}"/></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="#808080"/>
  <g filter="url(#O)">
    <rect width="${width}" height="${height}" fill="#000080"/>
    <rect width="${width}" height="${height}" fill="url(#Y)" style="mix-blend-mode:screen"/>
    <rect width="${width}" height="${height}" fill="url(#X)" style="mix-blend-mode:screen"/>
    <rect x="${insetX}" y="${insetY}" width="${innerWidth}" height="${innerHeight}" rx="${innerRx}" ry="${innerRy}" fill="#808080" filter="url(#I)"/>
  </g>
</svg>`;
}

function dataUri(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

type OpticalFilterProps = {
  id: string;
  geometry: LiquidGlassGeometry;
};

export function LiquidGlassOpticalFilter({ id, geometry }: OpticalFilterProps) {
  const width = Math.max(1, Math.round(geometry.width));
  const height = Math.max(1, Math.round(geometry.height));
  const radiusX = Math.max(1, geometry.radiusX);
  const radiusY = Math.max(1, geometry.radiusY);
  const scale = height / 280;
  const extent = { x: '0', y: '0', width: '100%', height: '100%' };

  return (
    <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
      <filter id={id} {...extent} colorInterpolationFilters="sRGB">
        <feImage
          x="0"
          y="0"
          width={width}
          height={height}
          href={dataUri(opticalMapSvg({ width, height, radiusX, radiusY }))}
          result="displacementMap"
        />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={74 * scale} xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" result="displacedR" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={72 * scale} xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" result="displacedG" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={70 * scale} xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" result="displacedB" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        <feBlend in="displacedR" in2="displacedG" mode="screen" result="rg" />
        <feBlend in="rg" in2="displacedB" mode="screen" />
      </filter>
    </svg>
  );
}

function iconButtonMapSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="Y" x1="0" x2="0" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#00ff00"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="X" x1="0%" x2="100%" y1="0" y2="0">
      <stop offset="0%" stop-color="#ff0000"/>
      <stop offset="100%" stop-color="#000000"/>
    </linearGradient>
    <clipPath id="C"><circle cx="24" cy="24" r="24"/></clipPath>
    <filter id="S"><feGaussianBlur stdDeviation=".75"/></filter>
  </defs>
  <rect width="48" height="48" fill="#808080"/>
  <g clip-path="url(#C)" filter="url(#S)">
    <rect width="48" height="48" fill="#000080"/>
    <rect width="48" height="48" fill="url(#Y)" style="mix-blend-mode:screen"/>
    <rect width="48" height="48" fill="url(#X)" style="mix-blend-mode:screen"/>
    <circle cx="24" cy="24" r="16.32" fill="#808080"/>
  </g>
</svg>`;
}

export function LiquidGlassIconButtonFilter({ id }: { id: string }) {
  return (
    <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage x="0" y="0" width="48" height="48" href={dataUri(iconButtonMapSvg())} result="displacementMap" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={9.025} xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" result="displacedR" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={8.015} xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" result="displacedG" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
        <feDisplacementMap in="SourceGraphic" in2="displacementMap" scale={7.01} xChannelSelector="R" yChannelSelector="G" />
        <feColorMatrix type="matrix" result="displacedB" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
        <feBlend in="displacedR" in2="displacedG" mode="screen" result="rg" />
        <feBlend in="rg" in2="displacedB" mode="screen" />
      </filter>
    </svg>
  );
}
