import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Button, Toggle } from 'konsta/react';
import { Text } from '../ui';
import { WORKED_MUSCLE_LABELS, WORKED_MUSCLE_VIEWS, type WorkedMuscleView } from './workedMuscleData';
import { loadWorkedMuscleAtlas, muscleIdAtPixel, type WorkedMuscleAtlasAssets } from './workedMuscleAtlas';
import './worked-muscles.css';

export type WorkedMusclesProps = {
  primaryMuscleIds: readonly string[];
  secondaryMuscleIds: readonly string[];
  className?: string;
};

type MuscleDetail = { muscleId: string };

type AnatomyViewProps = {
  view: WorkedMuscleView;
  primary: ReadonlySet<string>;
  secondary: ReadonlySet<string>;
  showPrimary: boolean;
  showSecondary: boolean;
};

function AnatomyView({ view, primary, secondary, showPrimary, showSecondary }: AnatomyViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<WorkedMuscleAtlasAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<MuscleDetail | null>(null);
  const { indices } = WORKED_MUSCLE_VIEWS[view];
  const viewLabel = view === 'front' ? 'Вид спереди' : 'Вид сзади';

  useEffect(() => {
    let active = true;
    loadWorkedMuscleAtlas(view).then((loaded) => {
      if (active) { setAssets(loaded); setError(null); }
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : 'Ошибка загрузки анатомии');
      }
    });
    return () => { active = false; };
  }, [view, retry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = assets.width;
    canvas.height = assets.height;
    context.clearRect(0, 0, assets.width, assets.height);
    context.drawImage(assets.neutral, 0, 0);
    const primarySprites: number[] = [];
    const secondarySprites: number[] = [];
    for (const [rawId, muscleId] of Object.entries(indices)) {
      const id = Number(rawId);
      if (!assets.sprites[id]) continue;
      if (showPrimary && primary.has(muscleId)) primarySprites.push(id);
      else if (showSecondary && secondary.has(muscleId)) secondarySprites.push(id);
    }
    const draw = (image: HTMLImageElement, ids: readonly number[], alpha: number) => {
      context.save();
      context.globalAlpha = alpha;
      for (const id of ids) {
        const sprite = assets.sprites[id];
        context.drawImage(
          image,
          sprite.atlasX, sprite.atlasY, sprite.width, sprite.height,
          sprite.targetX, sprite.targetY, sprite.width, sprite.height,
        );
      }
      context.restore();
    };
    // Glow was blurred when building PNGs; rendering is only image compositing.
    draw(assets.glowAtlas, secondarySprites, 0.6);
    draw(assets.glowAtlas, primarySprites, 1);
    draw(assets.colorAtlas, secondarySprites, 0.54);
    draw(assets.colorAtlas, primarySprites, 1);
  }, [assets, indices, primary, secondary, showPrimary, showSecondary]);

  const onTap = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!assets) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return;
    const x = Math.floor(fx * assets.width), y = Math.floor(fy * assets.height);
    const numericId = muscleIdAtPixel(assets.mask, assets.width, assets.height, x, y);
    const muscleId = (indices as Readonly<Record<number, string>>)[numericId];
    if (!muscleId) { setDetail(null); return; }
    // Mobile tap replaces hover. Text persists under the figure, never floats
    // over or interferes with the next tap.
    setDetail({ muscleId });
  };

  return (
    <section className="worked-muscles__view" aria-label={viewLabel}>
      <Text variant="headline" className="worked-muscles__view-title">{viewLabel}</Text>
      <div className="worked-muscles__image-wrap" aria-busy={!assets && !error}>
        {!assets && !error ? (
          <Text variant="footnote" className="worked-muscles__loading" role="status">Загрузка анатомии…</Text>
        ) : null}
        <canvas
          ref={canvasRef}
          className="worked-muscles__canvas"
          onClick={onTap}
          role="img"
          aria-label={viewLabel + '. Коснитесь мышцы, чтобы увидеть название'}
        />
      </div>
      {detail ? (
        <div className="worked-muscles__tap-detail" role="status">
          <Text variant="body">{WORKED_MUSCLE_LABELS[detail.muscleId] ?? detail.muscleId}</Text>
          <Text variant="caption" tone="muted">{
            showPrimary && primary.has(detail.muscleId) ? 'Основная мышца'
              : showSecondary && secondary.has(detail.muscleId) ? 'Вспомогательная мышца'
                : 'Не задействована в тренировке'
          }</Text>
        </div>
      ) : null}
      {error ? (
        <div className="worked-muscles__error">
          <Text variant="footnote" className="worked-muscles__error-message" role="alert">{error}</Text>
          <Button onClick={() => { setError(null); setAssets(null); setRetry((value) => value + 1); }}>
            Повторить
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Read-only training summary; only role visibility toggles mutate presentation state. */
export function WorkedMuscles({ primaryMuscleIds, secondaryMuscleIds, className = '' }: WorkedMusclesProps) {
  const [showPrimary, setShowPrimary] = useState(true);
  const [showSecondary, setShowSecondary] = useState(true);
  const primary = useMemo(() => new Set(primaryMuscleIds), [primaryMuscleIds]);
  const secondary = useMemo(() => new Set(secondaryMuscleIds), [secondaryMuscleIds]);

  return (
    <section className={'worked-muscles ' + className}>
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
