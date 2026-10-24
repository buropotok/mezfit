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
};

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
    ? (view === 'front' ? 'female-three-quarter-v2-corrected-underlay' : 'female-rear-v5-saturated')
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


/** Map either a male virtual chest slice or a female physical copy to its original zone. */
export function getPectoralisSourceSprite(
  alias: AtlasSprite,
  sprites: Readonly<Record<string, AtlasSprite>>,
): AtlasSprite | undefined {
  if (alias.id !== 'pectoralis_major') return undefined;
  const indexed = sprites[String(alias.index)];
  if (indexed && indexed.id !== 'pectoralis_major') return indexed;
  return Object.values(sprites).find((part) =>
    PECTORALIS_MAJOR_PART_IDS.some((id) => id === part.id)
    && part.targetX === alias.targetX && part.targetY === alias.targetY
    && part.width === alias.width && part.height === alias.height,
  );
}

async function fetchWorkedMuscleAtlas(view: WorkedMuscleView, sex: WorkedMuscleSex): Promise<WorkedMuscleAtlas> {
  const config = getWorkedMuscleViewConfig(sex, view);
  const [manifestResponse, maskResponse, neutral, colorAtlas, glowAtlas] = await Promise.all([
    getStaticFile(assetUrl(config.manifest, view, sex)),
    getStaticFile(assetUrl(config.mask, view, sex)),
    loadStaticImage(assetUrl(config.neutral, view, sex)),
    loadStaticImage(assetUrl(config.colorAtlas, view, sex)),
    loadStaticImage(assetUrl(config.glowAtlas, view, sex)),
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
  // The female three-quarter atlas contains three independent pectoralis-major
  // sprite copies; the original upper/middle/lower regions stay independently tappable.
  // Male anatomy still uses the original six virtual left/right alias slices.
  const pectoralisMajorSprites = view !== 'front' ? []
    : sex === 'female'
      ? Object.values(sprites).filter((sprite) => sprite.id === 'pectoralis_major')
      : createPectoralisMajorSprites(sprites, config.width);
  return { width: config.width, height: config.height, sprites, pectoralisMajorSprites, mask, neutral, colorAtlas, glowAtlas };
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
