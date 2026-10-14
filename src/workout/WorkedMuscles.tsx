import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Toggle } from 'konsta/react';
import { Text } from '../ui';
import { WORKED_MUSCLE_LABELS, WORKED_MUSCLE_VIEWS, type WorkedMuscleView } from './workedMuscleData';
import { createNeutralWorkedMusclePixels, decodeWorkedMuscleMask, renderWorkedMusclePixels } from './workedMuscleMask';
import './worked-muscles.css';

export type WorkedMusclesProps = {
  primaryMuscleIds: readonly string[];
  secondaryMuscleIds: readonly string[];
  className?: string;
};

type ViewAssets = {
  source: Uint8ClampedArray;
  neutral: Uint8ClampedArray;
  mask: Uint8Array;
  width: number;
  height: number;
};

type MuscleTooltip = {
  name: string;
  category: string;
  left: number;
  top: number;
};

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return new URL(`${base}${path}`, window.location.origin).href;
}

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('Не удалось загрузить анатомическое изображение')); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    image.src = src;
  });
}

async function loadViewAssets(view: WorkedMuscleView, signal: AbortSignal): Promise<ViewAssets> {
  const config = WORKED_MUSCLE_VIEWS[view];
  const [image, response] = await Promise.all([
    loadImage(assetUrl(config.image), signal),
    fetch(assetUrl(config.mask), { signal }),
  ]);
  if (!response.ok) throw new Error(`Не удалось загрузить маску: ${response.status}`);
  const mask = decodeWorkedMuscleMask(await response.arrayBuffer(), view);
  if (image.naturalWidth !== config.width || image.naturalHeight !== config.height) {
    throw new Error('Размер изображения не совпадает с маской');
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = config.width;
  sourceCanvas.height = config.height;
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas недоступен');
  context.drawImage(image, 0, 0);
  const source = context.getImageData(0, 0, config.width, config.height).data;
  const smoothingPercent = view === 'front' ? 84 : 59;
  return {
    source,
    neutral: createNeutralWorkedMusclePixels(source, mask, smoothingPercent),
    mask,
    width: config.width,
    height: config.height,
  };
}

type AnatomyViewProps = {
  view: WorkedMuscleView;
  primary: ReadonlySet<string>;
  secondary: ReadonlySet<string>;
  showPrimary: boolean;
  showSecondary: boolean;
};

function AnatomyView({ view, primary, secondary, showPrimary, showSecondary }: AnatomyViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<ViewAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<MuscleTooltip | null>(null);
  const { indices } = WORKED_MUSCLE_VIEWS[view];
  const viewLabel = view === 'front' ? 'Вид спереди' : 'Вид сзади';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAssets(null);
    loadViewAssets(view, controller.signal).then((loaded) => {
      if (!controller.signal.aborted) { setAssets(loaded); setLoading(false); }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); setLoading(false); }
    });
    return () => controller.abort();
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets) return;
    canvas.width = assets.width;
    canvas.height = assets.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    const frame = renderWorkedMusclePixels(
      assets.source,
      assets.mask,
      indices,
      primary,
      secondary,
      showPrimary,
      showSecondary,
      assets.neutral,
    );
    context.putImageData(new ImageData(new Uint8ClampedArray(frame), assets.width, assets.height), 0, 0);

    // The approved HTML applies glow to a separate blurred mask, not to the
    // muscle texture. Restore the sharp selected pixels after the glow pass.
    const roles = new Uint8Array(256);
    for (const [numericId, muscleId] of Object.entries(indices)) {
      const id = Number(numericId);
      if (showPrimary && primary.has(muscleId)) roles[id] = 1;
      else if (showSecondary && secondary.has(muscleId)) roles[id] = 2;
    }
    if (!roles.some(Boolean)) return;
    const glowPixels = new Uint8ClampedArray(frame.length);
    const selectedPixels = new Uint8ClampedArray(frame.length);
    let hasSelected = false;
    for (let pixel = 0, offset = 0; pixel < assets.mask.length; pixel += 1, offset += 4) {
      const role = roles[assets.mask[pixel]];
      if (!role || assets.source[offset + 3] === 0) continue;
      hasSelected = true;
      glowPixels[offset] = 74;
      glowPixels[offset + 1] = 199;
      glowPixels[offset + 2] = 255;
      glowPixels[offset + 3] = role === 1 ? 190 : 110;
      selectedPixels[offset] = frame[offset];
      selectedPixels[offset + 1] = frame[offset + 1];
      selectedPixels[offset + 2] = frame[offset + 2];
      selectedPixels[offset + 3] = frame[offset + 3];
    }
    if (!hasSelected) return;
    const createLayer = (pixels: Uint8ClampedArray) => {
      const layer = document.createElement('canvas');
      layer.width = assets.width;
      layer.height = assets.height;
      const layerContext = layer.getContext('2d');
      if (!layerContext) return null;
      layerContext.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), assets.width, assets.height), 0, 0,
      );
      return layer;
    };
    const glowLayer = createLayer(glowPixels);
    const selectedLayer = createLayer(selectedPixels);
    if (!glowLayer || !selectedLayer) return;
    context.save();
    context.globalAlpha = 0.24;
    context.filter = 'blur(8px)';
    context.drawImage(glowLayer, 0, 0);
    context.restore();
    context.drawImage(selectedLayer, 0, 0);
  }, [assets, indices, primary, secondary, showPrimary, showSecondary]);

  useEffect(() => {
    if (!tooltip) return;
    const timeout = window.setTimeout(() => setTooltip(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [tooltip]);

  const onTap = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!assets) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const x = Math.max(0, Math.min(assets.width - 1, Math.floor(fx * assets.width)));
    const y = Math.max(0, Math.min(assets.height - 1, Math.floor(fy * assets.height)));
    const numericId = assets.mask[y * assets.width + x];
    const muscleId = (indices as Readonly<Record<number, string>>)[numericId];
    if (!muscleId) { setTooltip(null); return; }
    const category = showPrimary && primary.has(muscleId) ? 'Основная мышца'
      : showSecondary && secondary.has(muscleId) ? 'Вспомогательная мышца'
        : 'Не отображается в тренировке';
    setTooltip({
      name: WORKED_MUSCLE_LABELS[muscleId] ?? muscleId,
      category,
      left: Math.min(82, Math.max(18, fx * 100)),
      top: Math.min(90, Math.max(12, fy * 100)),
    });
  };

  return (
    <section className="worked-muscles__view" aria-label={viewLabel}>
      <Text variant="headline" className="worked-muscles__view-title">{viewLabel}</Text>
      <div className="worked-muscles__image-wrap" aria-busy={loading}>
        {loading ? <Text variant="footnote" className="worked-muscles__loading" role="status">Загрузка анатомии…</Text> : null}
        <canvas
          ref={canvasRef}
          className="worked-muscles__canvas"
          onClick={onTap}
          role="img"
          aria-label={`${viewLabel}, мышцы после тренировки. Нажмите на мышцу, чтобы узнать название`}
        />
        {tooltip ? (
          <div
            className="worked-muscles__tooltip"
            style={{ left: `${tooltip.left}%`, top: `${tooltip.top}%` }}
            role="status"
          >
            <Text variant="body">{tooltip.name}</Text>
            <Text variant="caption" tone="muted">{tooltip.category}</Text>
          </div>
        ) : null}
      </div>
      {error ? <Text variant="footnote" className="worked-muscles__error" role="alert">{error}</Text> : null}
    </section>
  );
}

/** Read-only training summary: only the two visibility toggles mutate local presentation state. */
export function WorkedMuscles({ primaryMuscleIds, secondaryMuscleIds, className = '' }: WorkedMusclesProps) {
  const [showPrimary, setShowPrimary] = useState(true);
  const [showSecondary, setShowSecondary] = useState(true);
  const primary = useMemo(() => new Set(primaryMuscleIds), [primaryMuscleIds]);
  const secondary = useMemo(() => new Set(secondaryMuscleIds), [secondaryMuscleIds]);

  return (
    <section className={`worked-muscles ${className}`.trim()}>
      <Text variant="title" className="worked-muscles__title">Проработанные мышцы</Text>
      <div className="worked-muscles__filters">
        <label className="worked-muscles__filter">
          <Text variant="body">Основные</Text>
          <Toggle component="div" checked={showPrimary} onChange={() => setShowPrimary((current) => !current)} />
        </label>
        <label className="worked-muscles__filter">
          <Text variant="body">Вспомогательные</Text>
          <Toggle component="div" checked={showSecondary} onChange={() => setShowSecondary((current) => !current)} />
        </label>
      </div>
      <div className="worked-muscles__views">
        <AnatomyView view="front" primary={primary} secondary={secondary} showPrimary={showPrimary} showSecondary={showSecondary} />
        <AnatomyView view="rear" primary={primary} secondary={secondary} showPrimary={showPrimary} showSecondary={showSecondary} />
      </div>
    </section>
  );
}
