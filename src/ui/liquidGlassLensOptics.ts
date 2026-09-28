export type LiquidGlassTint = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type LiquidGlassOptics = {
  tint: LiquidGlassTint;
  blurPx: number;
  saturation: number;
  brightness: number;
  bezelOpacity: number;
  borderOpacity: number;
  shadowOpacity: number;
  neutralEdge: number;
  rimWidth: number;
  rimStrength: number;
  trenchWidth: number;
  trenchStrength: number;
  refraction: number;
  rgbSpread: number;
  filterPaddingPercent: number;
};

export type LiquidGlassOpticsOverrides =
  & Partial<Omit<LiquidGlassOptics, 'tint'>>
  & { tint?: Partial<LiquidGlassTint> };

export type LiquidGlassGeometry = {
  width: number;
  height: number;
  radius: number;
};

export const LIQUID_GLASS_PRESETS = {
  lens: {
    tint: { r: 20, g: 20, b: 20, a: 0.17 },
    blurPx: 0,
    saturation: 1.05,
    brightness: 1.02,
    bezelOpacity: 0.86,
    borderOpacity: 0.14,
    shadowOpacity: 0.20,
    neutralEdge: 1.7,
    rimWidth: 8,
    rimStrength: 0.67,
    trenchWidth: 1,
    trenchStrength: 0.09,
    refraction: 8,
    rgbSpread: 0.1,
    filterPaddingPercent: 51,
  },
  clear: {
    tint: { r: 20, g: 20, b: 20, a: 0.08 },
    blurPx: 2,
    saturation: 1.08,
    brightness: 1.04,
    bezelOpacity: 0.72,
    borderOpacity: 0.12,
    shadowOpacity: 0.15,
    neutralEdge: 1.5,
    rimWidth: 7,
    rimStrength: 0.55,
    trenchWidth: 1,
    trenchStrength: 0.07,
    refraction: 6,
    rgbSpread: 0.08,
    filterPaddingPercent: 51,
  },
  frosted: {
    tint: { r: 28, g: 28, b: 30, a: 0.20 },
    blurPx: 14,
    saturation: 1.18,
    brightness: 1.04,
    bezelOpacity: 0.78,
    borderOpacity: 0.16,
    shadowOpacity: 0.18,
    neutralEdge: 1.8,
    rimWidth: 9,
    rimStrength: 0.58,
    trenchWidth: 1.5,
    trenchStrength: 0.08,
    refraction: 5.5,
    rgbSpread: 0.12,
    filterPaddingPercent: 51,
  },
  blue: {
    tint: { r: 10, g: 74, b: 138, a: 0.24 },
    blurPx: 10,
    saturation: 1.28,
    brightness: 1.05,
    bezelOpacity: 0.82,
    borderOpacity: 0.18,
    shadowOpacity: 0.18,
    neutralEdge: 1.7,
    rimWidth: 8,
    rimStrength: 0.68,
    trenchWidth: 1,
    trenchStrength: 0.09,
    refraction: 8,
    rgbSpread: 0.18,
    filterPaddingPercent: 51,
  },
  smoked: {
    tint: { r: 10, g: 10, b: 12, a: 0.36 },
    blurPx: 8,
    saturation: 1.02,
    brightness: 0.96,
    bezelOpacity: 0.90,
    borderOpacity: 0.18,
    shadowOpacity: 0.28,
    neutralEdge: 1.9,
    rimWidth: 9,
    rimStrength: 0.72,
    trenchWidth: 1.5,
    trenchStrength: 0.10,
    refraction: 8.5,
    rgbSpread: 0.12,
    filterPaddingPercent: 51,
  },
} as const satisfies Record<string, LiquidGlassOptics>;

export type LiquidGlassPresetName = keyof typeof LIQUID_GLASS_PRESETS;

export function resolveLiquidGlassOptics(
  preset: LiquidGlassPresetName,
  overrides?: LiquidGlassOpticsOverrides,
): LiquidGlassOptics {
  const base = LIQUID_GLASS_PRESETS[preset];
  return {
    ...base,
    ...overrides,
    tint: {
      ...base.tint,
      ...overrides?.tint,
    },
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function roundedRectSdf(x: number, y: number, halfW: number, halfH: number, radius: number) {
  const r = clamp(radius, 0.5, Math.min(halfW, halfH));
  const qx = Math.abs(x) - Math.max(0, halfW - r);
  const qy = Math.abs(y) - Math.max(0, halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

export function buildLiquidGlassVectorMap(
  canvas: HTMLCanvasElement,
  geometry: LiquidGlassGeometry,
  optics: Pick<
    LiquidGlassOptics,
    'neutralEdge' | 'rimWidth' | 'rimStrength' | 'trenchWidth' | 'trenchStrength'
  >,
  pixelRatio = 1.5,
) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const width = Math.max(1, geometry.width);
  const height = Math.max(1, geometry.height);
  const radius = clamp(geometry.radius, 0.5, Math.min(width, height) / 2);
  const sampleScale = clamp(pixelRatio || 1.5, 1.5, 3);
  const bitmapWidth = Math.max(128, Math.round(width * sampleScale));
  const bitmapHeight = Math.max(72, Math.round(height * sampleScale));

  canvas.width = bitmapWidth;
  canvas.height = bitmapHeight;

  const sx = bitmapWidth / width;
  const sy = bitmapHeight / height;
  const halfW = width / 2;
  const halfH = height / 2;
  const image = context.createImageData(bitmapWidth, bitmapHeight);
  const pixels = image.data;

  for (let j = 0; j < bitmapHeight; j += 1) {
    const y = (j + 0.5) / sy - halfH;
    for (let i = 0; i < bitmapWidth; i += 1) {
      const x = (i + 0.5) / sx - halfW;
      const sdf = roundedRectSdf(x, y, halfW, halfH, radius);
      const distanceInside = -sdf;
      let vx = 0;
      let vy = 0;

      if (distanceInside > optics.neutralEdge) {
        const epsilon = 0.35;
        const gx = roundedRectSdf(x + epsilon, y, halfW, halfH, radius)
          - roundedRectSdf(x - epsilon, y, halfW, halfH, radius);
        const gy = roundedRectSdf(x, y + epsilon, halfW, halfH, radius)
          - roundedRectSdf(x, y - epsilon, halfW, halfH, radius);
        const length = Math.hypot(gx, gy) || 1;
        const local = distanceInside - optics.neutralEdge;
        let magnitude = 0;

        if (local < optics.rimWidth) {
          magnitude += Math.sin(Math.PI * (local / Math.max(0.001, optics.rimWidth))) * optics.rimStrength;
        }
        if (local >= optics.rimWidth && local < optics.rimWidth + optics.trenchWidth) {
          const trenchProgress = (local - optics.rimWidth) / Math.max(0.001, optics.trenchWidth);
          magnitude -= Math.sin(Math.PI * trenchProgress) * optics.trenchStrength;
        }

        vx = (gx / length) * magnitude;
        vy = (gy / length) * magnitude;
      }

      const offset = (j * bitmapWidth + i) * 4;
      pixels[offset] = Math.round(clamp(128 + vx * 127, 0, 255));
      pixels[offset + 1] = Math.round(clamp(128 + vy * 127, 0, 255));
      pixels[offset + 2] = 128;
      pixels[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return {
    href: canvas.toDataURL('image/png'),
    width,
    height,
  };
}
