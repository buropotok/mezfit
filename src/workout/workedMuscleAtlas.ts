import {
  getWorkedMuscleViewConfig, PECTORALIS_MAJOR_PART_IDS, WORKED_MUSCLE_LABELS,
  type WorkedMuscleSex, type WorkedMuscleView,
} from './workedMuscleData';
import { decodeWorkedMuscleMask } from './workedMuscleMask';

export type AtlasSprite = {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly atlasX: number;
  readonly atlasY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly width: number;
  readonly height: number;
};

export type WorkedMuscleAtlas = {
  readonly width: number;
  readonly height: number;
  readonly sprites: Readonly<Record<string, AtlasSprite>>;
  readonly pectoralisMajorSprites: readonly AtlasSprite[];
  readonly mask: Uint8Array;
  readonly neutral: HTMLImageElement;
  readonly colorAtlas: HTMLImageElement;
  readonly glowAtlas: HTMLImageElement;
  readonly femaleLowerChest: HTMLCanvasElement | null;
};

/** Uploaded female chest artwork is cropped losslessly from native canvas coordinates. */
export const FEMALE_LOWER_CHEST_ARTWORK = {
  path: 'anatomy/female/front/pectoralis-lower-replacement.png',
  index: 3,
  x: 455,
  y: 400,
  width: 243,
  height: 149,
} as const;

/**
 * Restrict replacement artwork to the same native pixel IDs as touch selection.
 * Other chest zones and background must never receive lower-chest highlighting.
 * Called once during the female-front atlas load, not on each React render.
 */
export function clipMuscleArtworkToHitMask(
  rgba: Uint8ClampedArray, imageWidth: number, imageHeight: number,
  targetX: number, targetY: number,
  hitMask: Uint8Array, canvasWidth: number, canvasHeight: number,
  muscleIndex: number,
): void {
  if (rgba.length !== imageWidth * imageHeight * 4 || hitMask.length !== canvasWidth * canvasHeight) {
    throw new Error('Размеры замещающего спрайта или маски не совпадают');
  }
  for (let row = 0; row < imageHeight; row += 1) {
    const canvasY = targetY + row;
    for (let column = 0; column < imageWidth; column += 1) {
      const canvasX = targetX + column;
      if (canvasX < 0 || canvasY < 0 || canvasX >= canvasWidth || canvasY >= canvasHeight
        || hitMask[canvasY * canvasWidth + canvasX] !== muscleIndex) {
        rgba[(row * imageWidth + column) * 4 + 3] = 0;
      }
    }
  }
}

function prepareFemaleLowerChestSprite(
  source: HTMLImageElement, mask: Uint8Array, canvasWidth: number, canvasHeight: number,
): HTMLCanvasElement {
  const { x, y, width, height, index } = FEMALE_LOWER_CHEST_ARTWORK;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Не удалось подготовить спрайт низа груди');
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  clipMuscleArtworkToHitMask(pixels.data, width, height, x, y, mask, canvasWidth, canvasHeight, index);
  context.putImageData(pixels, 0, 0);
  return canvas;
}

type HitRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
const cache = new Map<string, Promise<WorkedMuscleAtlas>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assetUrl(relativePath: string, view: WorkedMuscleView, sex: WorkedMuscleSex): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
  const revision = sex === 'female'
    ? (view === 'front' ? 'female-front-v4-lower-chest' : 'female-rear-v3-shifted')
    : (view === 'front' ? 'front84-mask3-atlas1' : 'rear59-atlas2-transparent');
  return new URL(base + relativePath + '?v=' + revision, window.location.origin).href;
}

async function getStaticFile(url: string): Promise<Response> {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error('Не удалось загрузить анатомию (' + response.status + ')');
  return response;
}

async function loadStaticImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => { image.onload = null; image.onerror = null; resolve(); };
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error('Не удалось загрузить PNG анатомии')); };
    image.src = url;
  });
  // Decode before first display: an already fetched but not decoded PNG may
  // otherwise cause a visible hitch on iOS and Android WebView.
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch {
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Не удалось декодировать PNG анатомии');
    }
  }
  return image;
}

export function parseWorkedMuscleAtlasManifest(
  raw: unknown,
  view: WorkedMuscleView,
  atlasWidth: number,
  atlasHeight: number,
  sex: WorkedMuscleSex = 'male',
): Readonly<Record<string, AtlasSprite>> {
  const config = getWorkedMuscleViewConfig(sex, view);
  const approvedTone = sex === 'female' ? null : (view === 'front' ? 84 : 59);
  if (!isRecord(raw) || raw.view !== view || raw.width !== config.width
    || raw.height !== config.height || raw.tonePercent !== approvedTone || !isRecord(raw.sprites)) {
    throw new Error('Некорректный манифест атласа: ' + view);
  }

  const expected = config.indices as Readonly<Record<string, string>>;
  const sprites: Record<string, AtlasSprite> = {};
  for (const [key, item] of Object.entries(raw.sprites)) {
    if (!isRecord(item) || !/^[1-9]\d*$/.test(key)) throw new Error('Некорректная зона атласа');
    const id = Number(key);
    if (item.index !== id || !expected[key] || item.id !== expected[key]
      || typeof item.label !== 'string' || typeof item.category !== 'string'
      || !nonnegativeInteger(item.atlasX) || !nonnegativeInteger(item.atlasY)
      || !nonnegativeInteger(item.targetX) || !nonnegativeInteger(item.targetY)
      || !positiveInteger(item.width) || !positiveInteger(item.height)) {
      throw new Error('Несовпадение ID или координат зоны ' + key);
    }
    if (item.atlasX + item.width > atlasWidth || item.atlasY + item.height > atlasHeight
      || item.targetX + item.width > config.width || item.targetY + item.height > config.height) {
      throw new Error('Спрайт выходит за границы атласа: ' + key);
    }
    sprites[key] = {
      index: id, id: item.id, label: item.label, category: item.category,
      atlasX: item.atlasX, atlasY: item.atlasY,
      targetX: item.targetX, targetY: item.targetY,
      width: item.width, height: item.height,
    };
  }
  if (Object.keys(sprites).length === 0) throw new Error('Атлас не содержит мышц');
  return sprites;
}

/**
 * Six virtual sprites per front view: three chest zones x left/right.
 * Their atlas pixels are shared with the original zones, so no second PNG,
 * extra downloads, or changes to the exact-hit mask are necessary.
 */
export function createPectoralisMajorSprites(
  sprites: Readonly<Record<string, AtlasSprite>>,
  canvasWidth: number,
): readonly AtlasSprite[] {
  const middle = Math.floor(canvasWidth / 2);
  const copies: AtlasSprite[] = [];
  for (const partId of PECTORALIS_MAJOR_PART_IDS) {
    const source = Object.values(sprites).find((sprite) => sprite.id === partId);
    if (!source) continue;
    const leftWidth = Math.max(0, Math.min(source.width, middle - source.targetX));
    const segments = [
      { offset: 0, width: leftWidth },
      { offset: leftWidth, width: source.width - leftWidth },
    ];
    for (const { offset, width } of segments) {
      if (width === 0) continue;
      copies.push({
        ...source,
        id: 'pectoralis_major',
        label: WORKED_MUSCLE_LABELS.pectoralis_major,
        atlasX: source.atlasX + offset,
        targetX: source.targetX + offset,
        width,
      });
    }
  }
  return copies;
}

async function fetchWorkedMuscleAtlas(view: WorkedMuscleView, sex: WorkedMuscleSex): Promise<WorkedMuscleAtlas> {
  const config = getWorkedMuscleViewConfig(sex, view);
  const [manifestResponse, maskResponse, neutral, colorAtlas, glowAtlas, lowerChestSource] = await Promise.all([
    getStaticFile(assetUrl(config.manifest, view, sex)),
    getStaticFile(assetUrl(config.mask, view, sex)),
    loadStaticImage(assetUrl(config.neutral, view, sex)),
    loadStaticImage(assetUrl(config.colorAtlas, view, sex)),
    loadStaticImage(assetUrl(config.glowAtlas, view, sex)),
    sex === 'female' && view === 'front'
      ? loadStaticImage(assetUrl(FEMALE_LOWER_CHEST_ARTWORK.path, view, sex))
      : Promise.resolve(null),
  ]);
  const [rawManifest, maskBytes] = await Promise.all([
    manifestResponse.json() as Promise<unknown>,
    maskResponse.arrayBuffer(),
  ]);
  const mask = decodeWorkedMuscleMask(maskBytes, view, sex);
  if (neutral.naturalWidth !== config.width || neutral.naturalHeight !== config.height
    || colorAtlas.naturalWidth !== glowAtlas.naturalWidth
    || colorAtlas.naturalHeight !== glowAtlas.naturalHeight) {
    throw new Error('Размеры PNG не совпадают с анатомической маской');
  }
  const sprites = parseWorkedMuscleAtlasManifest(
    rawManifest, view, colorAtlas.naturalWidth, colorAtlas.naturalHeight, sex,
  );
  if (lowerChestSource
    && (lowerChestSource.naturalWidth !== FEMALE_LOWER_CHEST_ARTWORK.width
      || lowerChestSource.naturalHeight !== FEMALE_LOWER_CHEST_ARTWORK.height
      || sprites[String(FEMALE_LOWER_CHEST_ARTWORK.index)]?.id !== 'pectoralis_lower')) {
    throw new Error('Неверный размер или ID спрайта низа груди');
  }
  const femaleLowerChest = lowerChestSource
    ? prepareFemaleLowerChestSprite(lowerChestSource, mask, config.width, config.height)
    : null;
  const pectoralisMajorSprites = view === 'front'
    ? createPectoralisMajorSprites(sprites, config.width) : [];
  return { width: config.width, height: config.height, sprites, pectoralisMajorSprites, mask, neutral, colorAtlas, glowAtlas, femaleLowerChest };
}

/**
 * Shared explicit owner for immutable media. All mounts and the background
 * warmer reuse the same in-flight promise and decoded image instances.
 * Failures are evicted so a later open retries normally.
 */
export function loadWorkedMuscleAtlas(view: WorkedMuscleView, sex: WorkedMuscleSex = 'male'): Promise<WorkedMuscleAtlas> {
  const key = `${sex}:${view}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = fetchWorkedMuscleAtlas(view, sex);
  cache.set(key, pending);
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

/** Exact native-resolution hit test; rectangle overlap never selects muscles. */
export function pickWorkedMuscleAt(
  mask: Uint8Array,
  width: number,
  height: number,
  rect: HitRect,
  clientX: number,
  clientY: number,
): number {
  if (rect.width <= 0 || rect.height <= 0 || mask.length !== width * height) return 0;
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return 0;
  return mask[Math.floor(fy * height) * width + Math.floor(fx * width)];
}
