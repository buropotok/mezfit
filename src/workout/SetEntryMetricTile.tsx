import type { Ref } from 'react';
import { GlassSurface, Text } from '../ui';
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
  blur: number;
  buttonRef?: Ref<HTMLElement>;
  onClick: () => void;
}

export function SetEntryMetricTile({ metric, value, ariaLabel, disabled, blur, buttonRef,
  onClick }: SetEntryMetricTileProps) {
  return <GlassSurface component="button" ref={buttonRef}
    shape="auto" contentClassName="set-entry-weight-reps__metric-content"
    preset="modalTuned" optics={false} blur={blur} halo="lifted"
    className="set-entry-weight-reps__metric-tile"
    aria-disabled={disabled} aria-label={ariaLabel} onClick={onClick}>
    <Text variant="body">{LABELS[metric]}</Text>
    <Text variant="body">{value}</Text>
  </GlassSurface>;
}
