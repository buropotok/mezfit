import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Toggle } from 'konsta/react';
import { Text } from '../ui';
import { WORKED_MUSCLE_LABELS, WORKED_MUSCLE_VIEWS, type WorkedMuscleView } from './workedMuscleData';
import { loadWorkedMuscleAtlas, pickWorkedMuscleAt, type WorkedMuscleAtlas } from './workedMuscleAtlas';
import './worked-muscles.css';

export type WorkedMusclesProps = {
  primaryMuscleIds: readonly string[];
  secondaryMuscleIds: readonly string[];
  className?: string;
};

type AnatomyViewProps = {
  view: WorkedMuscleView;
  primary: ReadonlySet<string>;
  secondary: ReadonlySet<string>;
  showPrimary: boolean;
  showSecondary: boolean;
};

type LastTap = {
  readonly label: string;
  readonly status: string;
};

function AnatomyView({ view, primary, secondary, showPrimary, showSecondary }: AnatomyViewProps) {
  const config = WORKED_MUSCLE_VIEWS[view];
  const viewLabel = view === 'front' ? 'Вид спереди' : 'Вид сзади';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [atlas, setAtlas] = useState<WorkedMuscleAtlas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTap, setLastTap] = useState<LastTap | null>(null);

  useEffect(() => {
    let disposed = false;
    loadWorkedMuscleAtlas(view)
      .then((loaded) => { if (!disposed) { setAtlas(loaded); setError(null); } })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить анатомию');
      });
    return () => { disposed = true; };
  }, [view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!atlas || !canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    context.globalAlpha = 1;
    context.clearRect(0, 0, atlas.width, atlas.height);
    context.drawImage(atlas.neutral, 0, 0);

    const visible: Array<{ sprite: (typeof atlas.sprites)[string]; role: 'primary' | 'secondary' }> = [];
    for (const sprite of Object.values(atlas.sprites)) {
      if (showPrimary && primary.has(sprite.id)) visible.push({ sprite, role: 'primary' });
      else if (showSecondary && secondary.has(sprite.id)) visible.push({ sprite, role: 'secondary' });
    }
    const drawSprite = (image: HTMLImageElement, sprite: (typeof atlas.sprites)[string]) => {
      context.drawImage(
        image, sprite.atlasX, sprite.atlasY, sprite.width, sprite.height,
        sprite.targetX, sprite.targetY, sprite.width, sprite.height,
      );
    };

    // Both layers are baked PNGs. No runtime pixel loops, filters or blurs.
    for (const { sprite, role } of visible) {
      context.globalAlpha = role === 'primary' ? 1 : 0.58;
      drawSprite(atlas.glowAtlas, sprite);
    }
    for (const { sprite, role } of visible) {
      context.globalAlpha = role === 'primary' ? 1 : 0.54;
      drawSprite(atlas.colorAtlas, sprite);
    }
    context.globalAlpha = 1;
  }, [atlas, primary, secondary, showPrimary, showSecondary]);

  const onTap = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!atlas) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const numericId = pickWorkedMuscleAt(
      atlas.mask, atlas.width, atlas.height, rect, event.clientX, event.clientY,
    );
    const muscleId = (config.indices as Readonly<Record<number, string>>)[numericId];
    if (!muscleId || !atlas.sprites[String(numericId)]) {
      setLastTap(null);
      return;
    }
    const status = showPrimary && primary.has(muscleId) ? 'Основная мышца'
      : showSecondary && secondary.has(muscleId) ? 'Вспомогательная мышца'
        : 'Не задействована в этой тренировке';
    setLastTap({
      label: WORKED_MUSCLE_LABELS[muscleId] ?? muscleId,
      status,
    });
  };

  return (
    <section className="worked-muscles__view" aria-label={viewLabel}>
      <div className="worked-muscles__image-wrap" aria-busy={!atlas && !error}>
        <canvas
          ref={canvasRef}
          className={`worked-muscles__canvas worked-muscles__canvas--${view}`}
          width={config.width}
          height={config.height}
          onClick={onTap}
          role="img"
          aria-label={viewLabel + ': коснитесь мышцы, чтобы узнать название'}
        />
        {!atlas && !error ? (
          <Text variant="footnote" className="worked-muscles__loading" role="status">
            Загрузка анатомии…
          </Text>
        ) : null}
      </div>
      {lastTap && atlas ? (
        <div className="worked-muscles__tap-result" role="status">
          <Text variant="body">{lastTap.label}</Text>
          <Text variant="caption" tone="muted">
            {lastTap.status}
          </Text>
        </div>
      ) : null}
      {error ? <Text variant="footnote" className="worked-muscles__error" role="alert">{error}</Text> : null}
    </section>
  );
}

/** Read-only workout summary. The visibility toggles change presentation, not workout data. */
export function WorkedMuscles({ primaryMuscleIds, secondaryMuscleIds, className = '' }: WorkedMusclesProps) {
  const [showPrimary, setShowPrimary] = useState(true);
  const [showSecondary, setShowSecondary] = useState(true);
  const primary = useMemo(() => new Set(primaryMuscleIds), [primaryMuscleIds]);
  const secondary = useMemo(() => new Set(secondaryMuscleIds), [secondaryMuscleIds]);

  return (
    <section className={('worked-muscles ' + className).trim()}>
      <Text variant="title" className="worked-muscles__title">Проработанные мышцы</Text>
      <div className="worked-muscles__filters">
        <label className="worked-muscles__filter">
          <Toggle component="div" checked={showPrimary} onChange={() => setShowPrimary((current) => !current)} />
          <Text variant="footnote">Основные</Text>
        </label>
        <label className="worked-muscles__filter">
          <Toggle component="div" checked={showSecondary} onChange={() => setShowSecondary((current) => !current)} />
          <Text variant="footnote">Вспомогательные</Text>
        </label>
      </div>
      <div className="worked-muscles__views">
        <AnatomyView view="front" primary={primary} secondary={secondary} showPrimary={showPrimary} showSecondary={showSecondary} />
        <AnatomyView view="rear" primary={primary} secondary={secondary} showPrimary={showPrimary} showSecondary={showSecondary} />
      </div>
    </section>
  );
}
