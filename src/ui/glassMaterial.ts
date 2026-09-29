export type GlassMaterial = {
  tintR: number;
  tintG: number;
  tintB: number;
  tintA: number;
  blur: number;
  saturation: number;
  brightness: number;
  bezel: number;
  border: number;
  shadow: number;
  neutralEdge: number;
  rimWidth: number;
  rimStrength: number;
  trenchWidth: number;
  trenchStrength: number;
  depthWidth: number;
  depthRefraction: number;
  thickness: number;
  caustic: number;
  depthShadow: number;
  topGlint: number;
  refraction: number;
  rgbSpread: number;
  filterPadding: number;
};

export type GlassMaterialOverrides = Partial<GlassMaterial>;

export type GlassShape =
  | 'auto'
  | 'capsule'
  | { radius: number };

export type GlassGeometry = {
  width: number;
  height: number;
  radius: number;
};

export const MODAL_TUNED_GLASS: Readonly<GlassMaterial> = Object.freeze({
  tintR: 24,
  tintG: 24,
  tintB: 26,
  tintA: 0.27,
  blur: 2,
  saturation: 1.08,
  brightness: 0.9,
  bezel: 0.81,
  border: 0.03,
  shadow: 0.23,
  neutralEdge: 3.3,
  rimWidth: 15.5,
  rimStrength: 1.22,
  trenchWidth: 3,
  trenchStrength: 0.04,
  depthWidth: 34,
  depthRefraction: 0.2,
  thickness: 0.68,
  caustic: 0.42,
  depthShadow: 0.22,
  topGlint: 0.38,
  refraction: 10.7,
  rgbSpread: 0.2,
  filterPadding: 51,
});

export const LENS_GLASS: Readonly<GlassMaterial> = Object.freeze({
  tintR: 20,
  tintG: 20,
  tintB: 20,
  tintA: 0.17,
  blur: 0,
  saturation: 1.05,
  brightness: 1.02,
  bezel: 0.86,
  border: 0.14,
  shadow: 0.20,
  neutralEdge: 1.7,
  rimWidth: 8,
  rimStrength: 0.67,
  trenchWidth: 1,
  trenchStrength: 0.09,
  depthWidth: 20,
  depthRefraction: 0.10,
  thickness: 0.42,
  caustic: 0.24,
  depthShadow: 0.18,
  topGlint: 0.22,
  refraction: 8,
  rgbSpread: 0.1,
  filterPadding: 51,
});

export const CLEAR_GLASS: Readonly<GlassMaterial> = Object.freeze({
  tintR: 20,
  tintG: 20,
  tintB: 20,
  tintA: 0.08,
  blur: 2,
  saturation: 1.08,
  brightness: 1.04,
  bezel: 0.72,
  border: 0.12,
  shadow: 0.15,
  neutralEdge: 1.5,
  rimWidth: 7,
  rimStrength: 0.55,
  trenchWidth: 1,
  trenchStrength: 0.07,
  depthWidth: 24,
  depthRefraction: 0.11,
  thickness: 0.48,
  caustic: 0.28,
  depthShadow: 0.20,
  topGlint: 0.26,
  refraction: 6,
  rgbSpread: 0.08,
  filterPadding: 51,
});

export const FROSTED_GLASS: Readonly<GlassMaterial> = Object.freeze({
  tintR: 28,
  tintG: 28,
  tintB: 30,
  tintA: 0.20,
  blur: 14,
  saturation: 1.18,
  brightness: 1.04,
  bezel: 0.78,
  border: 0.16,
  shadow: 0.18,
  neutralEdge: 1.8,
  rimWidth: 9,
  rimStrength: 0.58,
  trenchWidth: 1.5,
  trenchStrength: 0.08,
  depthWidth: 28,
  depthRefraction: 0.12,
  thickness: 0.54,
  caustic: 0.30,
  depthShadow: 0.22,
  topGlint: 0.20,
  refraction: 5.5,
  rgbSpread: 0.12,
  filterPadding: 51,
});

export const BLUE_GLASS: Readonly<GlassMaterial> = Object.freeze({
  tintR: 10,
  tintG: 74,
  tintB: 138,
  tintA: 0.24,
  blur: 10,
  saturation: 1.28,
  brightness: 1.05,
  bezel: 0.82,
  border: 0.18,
  shadow: 0.18,
  neutralEdge: 1.7,
  rimWidth: 8,
  rimStrength: 0.68,
  trenchWidth: 1,
  trenchStrength: 0.09,
  depthWidth: 30,
  depthRefraction: 0.15,
  thickness: 0.58,
  caustic: 0.34,
  depthShadow: 0.24,
  topGlint: 0.24,
  refraction: 8,
  rgbSpread: 0.18,
  filterPadding: 51,
});

export const SMOKED_GLASS: Readonly<GlassMaterial> = Object.freeze({
  tintR: 10,
  tintG: 10,
  tintB: 12,
  tintA: 0.36,
  blur: 8,
  saturation: 1.02,
  brightness: 0.96,
  bezel: 0.90,
  border: 0.18,
  shadow: 0.28,
  neutralEdge: 1.9,
  rimWidth: 9,
  rimStrength: 0.72,
  trenchWidth: 1.5,
  trenchStrength: 0.10,
  depthWidth: 28,
  depthRefraction: 0.14,
  thickness: 0.64,
  caustic: 0.25,
  depthShadow: 0.34,
  topGlint: 0.18,
  refraction: 8.5,
  rgbSpread: 0.12,
  filterPadding: 51,
});

export const GLASS_PRESETS = Object.freeze({
  modalTuned: MODAL_TUNED_GLASS,
  lens: LENS_GLASS,
  clear: CLEAR_GLASS,
  frosted: FROSTED_GLASS,
  blue: BLUE_GLASS,
  smoked: SMOKED_GLASS,
});

export type GlassPresetName = keyof typeof GLASS_PRESETS;

export function resolveGlassMaterial(
  preset: GlassPresetName = 'modalTuned',
  overrides?: GlassMaterialOverrides,
): GlassMaterial {
  return {
    ...GLASS_PRESETS[preset],
    ...overrides,
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function resolveGlassRadius(width: number, height: number, shape: GlassShape = 'auto') {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const shortSide = Math.min(safeWidth, safeHeight);

  if (shape === 'capsule') return shortSide / 2;
  if (typeof shape === 'object') return clamp(shape.radius, 0, shortSide / 2);
  if (shortSide <= 44) return shortSide / 2;

  const radius = 22 + 8.9 * Math.log(shortSide / 44);
  return Math.min(shortSide / 2, radius);
}

function roundedRectSdf(x: number, y: number, halfW: number, halfH: number, radius: number) {
  const r = clamp(radius, 0.5, Math.min(halfW, halfH));
  const qx = Math.abs(x) - Math.max(0, halfW - r);
  const qy = Math.abs(y) - Math.max(0, halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

export function buildGlassVectorMap(
  canvas: HTMLCanvasElement,
  geometry: GlassGeometry,
  material: Pick<
    GlassMaterial,
    | 'neutralEdge'
    | 'rimWidth'
    | 'rimStrength'
    | 'trenchWidth'
    | 'trenchStrength'
    | 'depthWidth'
    | 'depthRefraction'
  >,
  pixelRatio = 1.5,
) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const width = Math.max(1, geometry.width);
  const height = Math.max(1, geometry.height);
  const radius = clamp(geometry.radius, 0.5, Math.min(width, height) / 2);
  const sampleScale = clamp(pixelRatio || 1.5, 1.25, 2);
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

      if (distanceInside > material.neutralEdge) {
        const epsilon = 0.35;
        const gx = roundedRectSdf(x + epsilon, y, halfW, halfH, radius)
          - roundedRectSdf(x - epsilon, y, halfW, halfH, radius);
        const gy = roundedRectSdf(x, y + epsilon, halfW, halfH, radius)
          - roundedRectSdf(x, y - epsilon, halfW, halfH, radius);
        const length = Math.hypot(gx, gy) || 1;
        const local = distanceInside - material.neutralEdge;
        const bandPeak = Math.max(0.001, material.rimWidth * 0.42);
        const bandEnd = Math.max(bandPeak + 0.001, material.rimWidth + material.trenchWidth);
        let magnitude = 0;

        if (local < bandPeak) {
          const progress = local / bandPeak;
          magnitude = Math.sin(progress * Math.PI * 0.5) * material.rimStrength;
        } else if (local < bandEnd) {
          const progress = (local - bandPeak) / Math.max(0.001, bandEnd - bandPeak);
          magnitude = Math.cos(progress * Math.PI * 0.5) * material.rimStrength;
          magnitude -= Math.sin(progress * Math.PI) * material.trenchStrength * 0.5;
        }

        if (material.depthWidth > 0 && local < material.depthWidth) {
          const depthProgress = local / Math.max(0.001, material.depthWidth);
          magnitude += Math.sin(Math.PI * depthProgress) * material.depthRefraction;
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
