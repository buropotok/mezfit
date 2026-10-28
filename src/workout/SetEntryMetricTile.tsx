import { useEffect, useRef, type Ref } from 'react';
import { GlassSurface, Text } from '../ui';
import { PRESS_SCALE_DURATION, PRESS_SCALE_PEAK_TIME, startPressScale } from '../ui/PressScale';
import type { SetMetrics } from './setEntryTypes';

/** Shared metric card for every workout tracking type; UI Kit owns glass and typography. */
export type SetEntryMetricKind = 'weight_reps' | keyof SetMetrics;

const LABELS: Record<SetEntryMetricKind, string> = {
  weight_reps: 'Вес × Повторения',
  durationSeconds: 'Продолжительность',
  distanceMeters: 'Дистанция',
  reps: 'Повторения',
  weightKg: 'Вес',
};

export interface SetEntryMetricTileProps {
  metric: SetEntryMetricKind;
  value: string;
  ariaLabel: string;
  disabled: boolean;
  blur?: number;
  buttonRef?: Ref<HTMLElement>;
  onClick: () => void;
}

export function SetEntryMetricTile({ metric, value, ariaLabel, disabled, blur, buttonRef,
  onClick }: SetEntryMetricTileProps) {
  const animations = useRef<Animation[]>([]);
  useEffect(() => () => { animations.current.forEach(animation => animation.cancel()); }, []);
  const press = (element: HTMLElement) => {
    if (disabled) return;
    animations.current.forEach(animation => animation.cancel());
    const scale = startPressScale(element, 0.95);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const halo = element.animate([
      { '--ui-glass-surface-halo-opacity': '1', easing: 'ease-out' },
      { '--ui-glass-surface-halo-opacity': '0.03', offset: PRESS_SCALE_PEAK_TIME / PRESS_SCALE_DURATION, easing: 'ease-in-out' },
      { '--ui-glass-surface-halo-opacity': '1' },
    ], { duration: reduced ? 1 : PRESS_SCALE_DURATION });
    animations.current = [scale, halo];
  };
  return <GlassSurface component="button" ref={buttonRef}
    shape="auto" contentClassName="set-entry-weight-reps__metric-content"
    preset="modalTuned" optics={false} blur={blur} halo="lifted"
    className="set-entry-weight-reps__metric-tile"
    aria-disabled={disabled} aria-label={ariaLabel}
    onPointerDown={event => press(event.currentTarget)}
    onClick={() => { if (!disabled) onClick(); }}>
    <Text variant="body">{LABELS[metric]}</Text>
    <Text variant="body">{value}</Text>
  </GlassSurface>;
}
