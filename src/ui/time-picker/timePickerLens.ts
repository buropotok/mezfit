export interface TimeLensVectorField {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  scale: number;
}

export interface TimeLensVectorFields {
  edge: TimeLensVectorField;
  zoom: TimeLensVectorField;
  specular: TimeLensVectorField;
}

export interface TimeLensAssets {
  edgeHref: string;
  edgeScale: number;
  zoomHref: string;
  zoomScale: number;
}

const DEFAULT_WIDTH = 288;
const DEFAULT_HEIGHT = 72;
const DEFAULT_PIXEL_RATIO = 2;
const EDGE_BEZEL_WIDTH = 18;
const GLASS_THICKNESS = 96;
const REFRACTIVE_INDEX = 1.5;
const ZOOM_MAGNIFICATION = 1.55;
const SPECULAR_THICKNESS = 2.25;
const SPECULAR_ANGLE = -Math.PI / 3;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function convexSquircle(x: number) {
  return Math.pow(1 - Math.pow(1 - x, 4), 1 / 4);
}

function roundedRectSdf(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
) {
  const safeRadius = clamp(radius, 0.5, Math.min(halfWidth, halfHeight));
  const qx = Math.abs(x) - Math.max(0, halfWidth - safeRadius);
  const qy = Math.abs(y) - Math.max(0, halfHeight - safeRadius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);

  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - safeRadius;
}

function calculateRefractionProfile(samples = 160) {
  const eta = 1 / REFRACTIVE_INDEX;
  const result: number[] = [];

  const refract = (normalX: number, normalY: number) => {
    const dot = normalY;
    const k = 1 - eta * eta * (1 - dot * dot);
    if (k < 0) return null;

    const root = Math.sqrt(k);
    return [
      -(eta * dot + root) * normalX,
      eta - (eta * dot + root) * normalY,
    ] as const;
  };

  for (let index = 0; index < samples; index += 1) {
    const x = (index + 0.5) / samples;
    const y = convexSquircle(x);
    const dx = x < 0.999 ? 0.0001 : -0.0001;
    const y2 = convexSquircle(clamp(x + dx, 0, 1));
    const derivative = (y2 - y) / dx;
    const magnitude = Math.hypot(derivative, 1);
    const normalX = -derivative / magnitude;
    const normalY = -1 / magnitude;
    const refracted = refract(normalX, normalY);

    if (!refracted || Math.abs(refracted[1]) < 0.000001) {
      result.push(0);
      continue;
    }

    const remainingHeight = y * EDGE_BEZEL_WIDTH + GLASS_THICKNESS;
    result.push(refracted[0] * (remainingHeight / refracted[1]));
  }

  return result;
}

function createNeutralPixels(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 128;
    pixels[offset + 1] = 128;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }

  return pixels;
}

function writeVector(
  pixels: Uint8ClampedArray,
  offset: number,
  x: number,
  y: number,
) {
  pixels[offset] = Math.round(clamp(128 + x * 127, 0, 255));
  pixels[offset + 1] = Math.round(clamp(128 + y * 127, 0, 255));
  pixels[offset + 2] = 128;
  pixels[offset + 3] = 255;
}

export function buildTimeLensVectorFields({
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  pixelRatio = DEFAULT_PIXEL_RATIO,
  includeSpecular = true,
}: {
  width?: number;
  height?: number;
  pixelRatio?: number;
  includeSpecular?: boolean;
} = {}): TimeLensVectorFields {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safePixelRatio = clamp(pixelRatio || 1, 1, 3);
  const bitmapWidth = Math.max(1, Math.round(safeWidth * safePixelRatio));
  const bitmapHeight = Math.max(1, Math.round(safeHeight * safePixelRatio));
  const halfWidth = safeWidth / 2;
  const halfHeight = safeHeight / 2;
  const radius = halfHeight;
  const epsilon = 0.3;
  const edgePixels = createNeutralPixels(bitmapWidth, bitmapHeight);
  const zoomPixels = createNeutralPixels(bitmapWidth, bitmapHeight);
  const specularPixels = new Uint8ClampedArray(bitmapWidth * bitmapHeight * 4);
  const refractionProfile = calculateRefractionProfile();
  const edgeScale = Math.max(1, ...refractionProfile.map(Math.abs));
  const zoomFactor = 1 - 1 / ZOOM_MAGNIFICATION;
  const zoomMaxX = halfWidth * zoomFactor;
  const zoomMaxY = halfHeight * zoomFactor;
  const zoomScale = Math.max(1, Math.hypot(zoomMaxX, zoomMaxY));
  const lightX = Math.cos(SPECULAR_ANGLE);
  const lightY = Math.sin(SPECULAR_ANGLE);

  for (let row = 0; row < bitmapHeight; row += 1) {
    const y = (row + 0.5) / safePixelRatio - halfHeight;

    for (let column = 0; column < bitmapWidth; column += 1) {
      const x = (column + 0.5) / safePixelRatio - halfWidth;
      const offset = (row * bitmapWidth + column) * 4;
      const sdf = roundedRectSdf(x, y, halfWidth, halfHeight, radius);
      const distanceInside = -sdf;

      if (distanceInside < 0) continue;

      const zoomX = -x * zoomFactor;
      const zoomY = -y * zoomFactor;
      writeVector(zoomPixels, offset, zoomX / zoomScale, zoomY / zoomScale);

      if (distanceInside <= EDGE_BEZEL_WIDTH) {
        const gx = roundedRectSdf(x + epsilon, y, halfWidth, halfHeight, radius)
          - roundedRectSdf(x - epsilon, y, halfWidth, halfHeight, radius);
        const gy = roundedRectSdf(x, y + epsilon, halfWidth, halfHeight, radius)
          - roundedRectSdf(x, y - epsilon, halfWidth, halfHeight, radius);
        const gradientLength = Math.hypot(gx, gy) || 1;
        const normalX = gx / gradientLength;
        const normalY = gy / gradientLength;
        const profileRatio = clamp(distanceInside / EDGE_BEZEL_WIDTH, 0, 1);
        const profileIndex = Math.min(
          refractionProfile.length - 1,
          Math.floor(profileRatio * refractionProfile.length),
        );
        const distance = refractionProfile[profileIndex] ?? 0;

        writeVector(
          edgePixels,
          offset,
          (-normalX * distance) / edgeScale,
          (-normalY * distance) / edgeScale,
        );
      }

      if (includeSpecular && distanceInside <= SPECULAR_THICKNESS) {
        const gx = roundedRectSdf(x + epsilon, y, halfWidth, halfHeight, radius)
          - roundedRectSdf(x - epsilon, y, halfWidth, halfHeight, radius);
        const gy = roundedRectSdf(x, y + epsilon, halfWidth, halfHeight, radius)
          - roundedRectSdf(x, y - epsilon, halfWidth, halfHeight, radius);
        const gradientLength = Math.hypot(gx, gy) || 1;
        const normalX = gx / gradientLength;
        const normalY = gy / gradientLength;
        const facing = Math.max(0, normalX * lightX + normalY * lightY);
        const edgeFalloff = Math.sqrt(
          Math.max(0, 1 - Math.pow(distanceInside / SPECULAR_THICKNESS, 2)),
        );
        const alpha = Math.round(clamp(facing * edgeFalloff * 255, 0, 255));

        specularPixels[offset] = 255;
        specularPixels[offset + 1] = 255;
        specularPixels[offset + 2] = 255;
        specularPixels[offset + 3] = alpha;
      }
    }
  }

  return {
    edge: {
      width: bitmapWidth,
      height: bitmapHeight,
      pixels: edgePixels,
      scale: edgeScale,
    },
    zoom: {
      width: bitmapWidth,
      height: bitmapHeight,
      pixels: zoomPixels,
      scale: zoomScale,
    },
    specular: {
      width: bitmapWidth,
      height: bitmapHeight,
      pixels: specularPixels,
      scale: 0,
    },
  };
}

function fieldToDataUrl(documentRef: Document, field: TimeLensVectorField) {
  const canvas = documentRef.createElement('canvas');
  canvas.width = field.width;
  canvas.height = field.height;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const image = context.createImageData(field.width, field.height);
  image.data.set(field.pixels);
  context.putImageData(image, 0, 0);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

const assetCache = new WeakMap<Document, TimeLensAssets>();

export function buildTimeLensAssets(documentRef: Document): TimeLensAssets | null {
  const cached = assetCache.get(documentRef);
  if (cached) return cached;

  const fields = buildTimeLensVectorFields({ includeSpecular: false });
  const edgeHref = fieldToDataUrl(documentRef, fields.edge);
  const zoomHref = fieldToDataUrl(documentRef, fields.zoom);
  if (!edgeHref || !zoomHref) return null;

  const assets = {
    edgeHref,
    edgeScale: fields.edge.scale,
    zoomHref,
    zoomScale: fields.zoom.scale,
  };
  assetCache.set(documentRef, assets);
  return assets;
}
