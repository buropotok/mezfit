import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Segmented, SegmentedButton, Toggle } from 'konsta/react';
import { Text } from '../ui';
import { getWorkedMuscleViewConfig, WORKED_MUSCLE_LABELS, type WorkedMuscleSex, type WorkedMuscleView } from './workedMuscleData';
import { loadWorkedMuscleAtlas, pickWorkedMuscleAt, type WorkedMuscleAtlas } from './workedMuscleAtlas';
import './worked-muscles.css';

export type WorkedMusclesProps = {
  primaryMuscleIds: readonly string[];
  secondaryMuscleIds: readonly string[];
  sex?: WorkedMuscleSex;
  className?: string;
};

type AnatomyViewProps = {
  view: WorkedMuscleView;
  sex: WorkedMuscleSex;
  primary: ReadonlySet<string>;
  secondary: ReadonlySet<string>;
  showPrimary: boolean;
  showSecondary: boolean;
};

type LastTap = {
  readonly label: string;
  readonly status: string;
};

function AnatomyView({ view, sex, primary, secondary, showPrimary, showSecondary }: AnatomyViewProps) {
  const config = getWorkedMuscleViewConfig(sex, view);
  const viewLabel = view === 'front' ? 'Вид спереди' : 'Вид сзади';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [atlas, setAtlas] = useState<WorkedMuscleAtlas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTap, setLastTap] = useState<LastTap | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const pointersRef = useRef(new Map<number, { x: number; y: number; startX: number; startY: number }>());
  const gestureRef = useRef({ moved: false, pinched: false, dist: 0, midX: 0, midY: 0 });

  const updateZoom = (scale: number, x: number, y: number) => {
    const nextScale = Math.max(1, Math.min(5, scale));
    const next = nextScale === 1 ? { scale: 1, x: 0, y: 0 } : { scale: nextScale, x, y };
    zoomRef.current = next;
    setZoom(next);
  };

  useEffect(() => {
    let disposed = false;
    loadWorkedMuscleAtlas(view, sex)
      .then((loaded) => { if (!disposed) { setAtlas(loaded); setError(null); } })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить анатомию');
      });
    return () => { disposed = true; };
  }, [view, sex]);

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

  const onTap = (clientX: number, clientY: number) => {
    if (!atlas) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const numericId = pickWorkedMuscleAt(
      atlas.mask, atlas.width, atlas.height, rect, clientX, clientY,
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

  const pointerPair = () => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return null;
    const a = points[0];
    const b = points[1];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  };
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!atlas) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
    });
    if (pointersRef.current.size === 1) {
      gestureRef.current = { moved: false, pinched: false, dist: 0, midX: 0, midY: 0 };
    } else {
      const pair = pointerPair();
      if (pair) gestureRef.current = {
        moved: true, pinched: true, dist: pair.distance, midX: pair.x, midY: pair.y,
      };
    }
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = pointersRef.current.get(event.pointerId);
    if (!current) return;
    event.preventDefault();
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 5) {
      gestureRef.current.moved = true;
    }
    pointersRef.current.set(event.pointerId, { ...current, x: event.clientX, y: event.clientY });
    const pair = pointerPair();
    if (pair) {
      const gesture = gestureRef.current;
      const previous = zoomRef.current;
      const nextScale = Math.max(1, Math.min(5, previous.scale * pair.distance / gesture.dist));
      const factor = nextScale / previous.scale;
      const wrap = event.currentTarget.parentElement?.getBoundingClientRect();
      const cx = wrap ? wrap.left + wrap.width / 2 : pair.x;
      const cy = wrap ? wrap.top + wrap.height / 2 : pair.y;
      updateZoom(
        nextScale,
        previous.x + (gesture.midX - cx - previous.x) * (1 - factor) + pair.x - gesture.midX,
        previous.y + (gesture.midY - cy - previous.y) * (1 - factor) + pair.y - gesture.midY,
      );
      gesture.dist = pair.distance;
      gesture.midX = pair.x;
      gesture.midY = pair.y;
      gesture.pinched = true;
    } else if (gestureRef.current.moved && zoomRef.current.scale > 1) {
      updateZoom(zoomRef.current.scale, zoomRef.current.x + dx, zoomRef.current.y + dy);
    }
  };
  const pointerEnd = (event: PointerEvent<HTMLCanvasElement>, canceled: boolean) => {
    const previous = pointersRef.current.get(event.pointerId);
    if (!previous) return;
    pointersRef.current.delete(event.pointerId);
    if (!canceled && pointersRef.current.size === 0 && !gestureRef.current.moved
        && !gestureRef.current.pinched && Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY) <= 8) {
      onTap(event.clientX, event.clientY);
    }
    if (pointersRef.current.size < 2) gestureRef.current.dist = 0;
  };

  return (
    <section className="worked-muscles__view" aria-label={viewLabel}>
      <div className="worked-muscles__image-wrap" aria-busy={!atlas && !error}>
        <canvas
          ref={canvasRef}
          className={`worked-muscles__canvas worked-muscles__canvas--${view} worked-muscles__canvas--${sex}-${view}`}
          width={config.width}
          height={config.height}
          style={{ transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={(event) => pointerEnd(event, false)}
          onPointerCancel={(event) => pointerEnd(event, true)}
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
export function WorkedMuscles({ primaryMuscleIds, secondaryMuscleIds, sex, className = '' }: WorkedMusclesProps) {
  const [manualSex, setManualSex] = useState<WorkedMuscleSex>('female');
  const activeSex = sex ?? manualSex;
  const [showPrimary, setShowPrimary] = useState(true);
  const [showSecondary, setShowSecondary] = useState(true);
  const primary = useMemo(() => new Set(primaryMuscleIds), [primaryMuscleIds]);
  const secondary = useMemo(() => new Set(secondaryMuscleIds), [secondaryMuscleIds]);

  return (
    <section className={('worked-muscles ' + className).trim()}>
      <Text variant="title" className="worked-muscles__title">Проработанные мышцы</Text>
      {sex === undefined ? (
        <div className="worked-muscles__sex-switch" role="group" aria-label="Пол анатомической модели">
          <Segmented rounded strong>
            <SegmentedButton active={activeSex === 'female'} onClick={() => setManualSex('female')}>Женский</SegmentedButton>
            <SegmentedButton active={activeSex === 'male'} onClick={() => setManualSex('male')}>Мужской</SegmentedButton>
          </Segmented>
        </div>
      ) : null}
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
        <AnatomyView key={`${activeSex}:front`} sex={activeSex} view="front" primary={primary} secondary={secondary} showPrimary={showPrimary} showSecondary={showSecondary} />
        <AnatomyView key={`${activeSex}:rear`} sex={activeSex} view="rear" primary={primary} secondary={secondary} showPrimary={showPrimary} showSecondary={showSecondary} />
      </div>
    </section>
  );
}
