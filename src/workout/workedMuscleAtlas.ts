import { WORKED_MUSCLE_VIEWS, type WorkedMuscleView } from './workedMuscleData';
import { decodeWorkedMuscleMask } from './workedMuscleMask';

export type AtlasSprite = {
  index: number;
  id: string;
  label: string;
  atlasX: number;
  atlasY: number;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  pixels: number;
};

export type WorkedMuscleAtlasAssets = {
  width: number;
  height: number;
  neutral: HTMLImageElement;
  colorAtlas: HTMLImageElement;
  glowAtlas: HTMLImageElement;
  mask: Uint8Array;
  sprites: Readonly<Record<number, AtlasSprite>>;
};

const versions: Readonly<Record<WorkedMuscleView, string>> = {
  front: 'front-v3',
  rear: 'rear-v1',
};
const cached = new Map<WorkedMuscleView, Promise<WorkedMuscleAtlasAssets>>();

function assetUrl(view: WorkedMuscleView, file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
  return new URL(base + 'anatomy/atlas/' + versions[view] + '/' + file, window.location.origin).href;
}

function fetchAsset(view: WorkedMuscleView, name: string): Promise<Response> {
  return fetch(assetUrl(view, name), { cache: 'force-cache' }).then((response) => {
    if (!response.ok) throw new Error('Не удалось загрузить анатомию (' + name + '): ' + response.status);
    return response;
  });
}

function loadImage(view: WorkedMuscleView, file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('Некорректное изображение анатомии (' + file + ')'));
        return;
      }
      if (typeof image.decode === 'function') {
        image.decode().then(() => resolve(image), () => reject(new Error('Не удалось декодировать ' + file)));
      } else {
        resolve(image);
      }
    };
    image.onerror = () => reject(new Error('Не удалось загрузить анатомию (' + file + ')'));
    image.src = assetUrl(view, file);
  });
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Validate the static manifest because mismatched coordinates would show wrong muscles. */
export function parseAtlasManifest(
  raw: unknown,
  view: WorkedMuscleView,
  atlasWidth: number,
  atlasHeight: number,
): Readonly<Record<number, AtlasSprite>> {
  const config = WORKED_MUSCLE_VIEWS[view];
  if (!objectRecord(raw)
    || raw.view !== view
    || raw.width !== config.width
    || raw.height !== config.height
    || raw.atlasWidth !== atlasWidth
    || raw.atlasHeight !== atlasHeight
    || raw.tonePercent !== (view === 'front' ? 84 : 59)
    || !objectRecord(raw.sprites)) {
    throw new Error('Несовместимый атлас мышц');
  }

  const sprites: Record<number, AtlasSprite> = {};
  for (const [rawIndex, muscleId] of Object.entries(config.indices)) {
    const index = Number(rawIndex);
    const entry = raw.sprites[rawIndex];
    if (entry === undefined) continue;
    if (!objectRecord(entry)
      || entry.id !== muscleId
      || entry.index !== index
      || typeof entry.label !== 'string'
      || !validInteger(entry.width, 1, config.width)
      || !validInteger(entry.height, 1, config.height)
      || !validInteger(entry.targetX, 0, config.width - entry.width)
      || !validInteger(entry.targetY, 0, config.height - entry.height)
      || !validInteger(entry.atlasX, 0, atlasWidth - entry.width)
      || !validInteger(entry.atlasY, 0, atlasHeight - entry.height)
      || !validInteger(entry.pixels, 1, config.width * config.height)) {
      throw new Error('Некорректные координаты мышцы ID ' + index);
    }
    sprites[index] = {
      index, id: muscleId, label: entry.label,
      width: entry.width, height: entry.height,
      targetX: entry.targetX, targetY: entry.targetY,
      atlasX: entry.atlasX, atlasY: entry.atlasY, pixels: entry.pixels,
    };
  }
  if (Object.keys(sprites).length !== Object.keys(raw.sprites).length || !Object.keys(sprites).length) {
    throw new Error('Атлас содержит неизвестные ID мышц');
  }
  return sprites;
}

/** Exact hit-testing: never use a sprite's bounding rectangle for a tap. */
export function muscleIdAtPixel(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= width || y < 0 || y >= height) return 0;
  if (mask.length !== width * height) return 0;
  return mask[y * width + x];
}

async function fetchViewAssets(view: WorkedMuscleView): Promise<WorkedMuscleAtlasAssets> {
  const [neutral, colorAtlas, glowAtlas, maskResponse, manifestResponse] = await Promise.all([
    loadImage(view, 'neutral.png'),
    loadImage(view, 'color-atlas.png'),
    loadImage(view, 'glow-atlas.png'),
    fetchAsset(view, 'mask.mezmask'),
    fetchAsset(view, 'manifest.json'),
  ]);
  const config = WORKED_MUSCLE_VIEWS[view];
  if (neutral.naturalWidth !== config.width || neutral.naturalHeight !== config.height
    || colorAtlas.naturalWidth !== glowAtlas.naturalWidth
    || colorAtlas.naturalHeight !== glowAtlas.naturalHeight) {
    throw new Error('Размер изображения не совпадает с атласом');
  }
  const [maskBytes, manifest] = await Promise.all([maskResponse.arrayBuffer(), manifestResponse.json()]);
  return {
    width: config.width,
    height: config.height,
    neutral,
    colorAtlas,
    glowAtlas,
    mask: decodeWorkedMuscleMask(maskBytes, view),
    sprites: parseAtlasManifest(manifest as unknown, view, colorAtlas.naturalWidth, colorAtlas.naturalHeight),
  };
}

/**
 * Shared single-flight image cache. Preloading and the visible component use
 * identical decoded image objects. The browser owns persistent HTTP caching.
 */
export function loadWorkedMuscleAtlas(view: WorkedMuscleView): Promise<WorkedMuscleAtlasAssets> {
  const existing = cached.get(view);
  if (existing) return existing;
  const promise = fetchViewAssets(view).catch((error: unknown) => {
    if (cached.get(view) === promise) cached.delete(view);
    throw error;
  });
  cached.set(view, promise);
  return promise;
}

/** Optional background warm-up must never block shell/navigation. */
export async function preloadWorkedMuscleAtlases(): Promise<void> {
  for (const view of ['front', 'rear'] as const) {
    try {
      await loadWorkedMuscleAtlas(view);
    } catch {
      // Feature failure remains local; visible mount may retry.
    }
  }
}
