import { Button, Range } from 'konsta/react';
import { useId, useState } from 'react';
import { Text } from './primitives';
import { LiquidGlassSurface } from './LiquidGlassSurface';
import {
  LIQUID_GLASS_PRESETS,
  resolveLiquidGlassOptics,
  type LiquidGlassOptics,
  type LiquidGlassPresetName,
} from './liquidGlassLensOptics';
import './LiquidGlassSurfaceCatalog.css';

type TunerRangeProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
};

function TunerRange({
  label,
  value,
  min,
  max,
  step,
  format = String,
  onChange,
}: TunerRangeProps) {
  const inputId = useId();
  return (
    <div className="ui-kit-liquid-glass-surface__control">
      <div className="ui-kit-liquid-glass-surface__control-heading">
        <label htmlFor={inputId}>
          <Text variant="footnote">{label}</Text>
        </label>
        <Text variant="caption" tone="muted">{format(value)}</Text>
      </div>
      <Range
        inputId={inputId}
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

const presetLabels: readonly { name: LiquidGlassPresetName; label: string }[] = [
  { name: 'lens', label: 'Lens' },
  { name: 'clear', label: 'Clear' },
  { name: 'frosted', label: 'Frosted' },
  { name: 'blue', label: 'Blue' },
  { name: 'smoked', label: 'Smoked' },
];

function copyPreset(name: LiquidGlassPresetName): LiquidGlassOptics {
  return resolveLiquidGlassOptics(name);
}

export function LiquidGlassSurfaceCatalog() {
  const [selectedPreset, setSelectedPreset] = useState<LiquidGlassPresetName | 'custom'>('lens');
  const [optics, setOptics] = useState<LiquidGlassOptics>(() => copyPreset('lens'));
  const [radius, setRadius] = useState(34);

  const choosePreset = (name: LiquidGlassPresetName) => {
    setSelectedPreset(name);
    setOptics(copyPreset(name));
  };

  const update = <K extends Exclude<keyof LiquidGlassOptics, 'tint'>>(key: K, value: LiquidGlassOptics[K]) => {
    setSelectedPreset('custom');
    setOptics(current => ({ ...current, [key]: value }));
  };

  const updateTint = (key: keyof LiquidGlassOptics['tint'], value: number) => {
    setSelectedPreset('custom');
    setOptics(current => ({
      ...current,
      tint: { ...current.tint, [key]: value },
    }));
  };

  return (
    <section className="ui-kit-liquid-glass-surface" aria-labelledby="ui-kit-liquid-glass-surface-title">
      <div className="ui-kit-liquid-glass-surface__header">
        <Text id="ui-kit-liquid-glass-surface-title" variant="title">Mezfit Liquid Glass Surface</Text>
        <Text variant="body">
          Оптическое ядро линзы из Text Only, вынесенное в самостоятельный surface-примитив.
        </Text>
        <Text variant="caption" tone="muted">
          Presets + live tuner · blur · tint · saturation · refraction · RGB spread · rim · bezel
        </Text>
      </div>

      <div className="ui-kit-liquid-glass-surface__preset-gallery" aria-label="Варианты стекла">
        {presetLabels.map(({ name, label }) => (
          <LiquidGlassSurface
            key={name}
            variant={name}
            radius={24}
            className="ui-kit-liquid-glass-surface__preset-card"
            contentClassName="ui-kit-liquid-glass-surface__preset-content"
          >
            <Text variant="headline">{label}</Text>
            <Text variant="caption" tone="muted">
              {LIQUID_GLASS_PRESETS[name].blurPx}px blur · {LIQUID_GLASS_PRESETS[name].refraction} refraction
            </Text>
          </LiquidGlassSurface>
        ))}
      </div>

      <div className="ui-kit-liquid-glass-surface__lab">
        <div className="ui-kit-liquid-glass-surface__preview-stage">
          <span className="ui-kit-liquid-glass-surface__orb ui-kit-liquid-glass-surface__orb--one" aria-hidden="true" />
          <span className="ui-kit-liquid-glass-surface__orb ui-kit-liquid-glass-surface__orb--two" aria-hidden="true" />
          <span className="ui-kit-liquid-glass-surface__grid" aria-hidden="true" />
          <LiquidGlassSurface
            variant="lens"
            optics={optics}
            radius={radius}
            className="ui-kit-liquid-glass-surface__preview"
            contentClassName="ui-kit-liquid-glass-surface__preview-content"
          >
            <Text variant="title">Liquid Glass</Text>
            <Text variant="body">Настраиваемая линза Mezfit</Text>
            <Text variant="caption" tone="muted">
              {selectedPreset === 'custom' ? 'Custom' : presetLabels.find(item => item.name === selectedPreset)?.label}
            </Text>
          </LiquidGlassSurface>
        </div>

        <div className="ui-kit-liquid-glass-surface__tuner">
          <div className="ui-kit-liquid-glass-surface__section-heading">
            <Text variant="headline">Preset</Text>
          </div>
          <div className="ui-kit-liquid-glass-surface__preset-buttons">
            {presetLabels.map(({ name, label }) => (
              <Button
                key={name}
                inline
                small
                rounded
                tonal={selectedPreset !== name}
                onClick={() => choosePreset(name)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="ui-kit-liquid-glass-surface__section-heading">
            <Text variant="headline">Material</Text>
          </div>
          <TunerRange label="Blur" value={optics.blurPx} min={0} max={30} step={1} format={value => `${value}px`} onChange={value => update('blurPx', value)} />
          <TunerRange label="Saturation" value={optics.saturation} min={0.5} max={2} step={0.01} format={value => value.toFixed(2)} onChange={value => update('saturation', value)} />
          <TunerRange label="Brightness" value={optics.brightness} min={0.7} max={1.3} step={0.01} format={value => value.toFixed(2)} onChange={value => update('brightness', value)} />
          <TunerRange label="Tint opacity" value={optics.tint.a} min={0} max={0.6} step={0.01} format={value => value.toFixed(2)} onChange={value => updateTint('a', value)} />
          <TunerRange label="Tint red" value={optics.tint.r} min={0} max={255} step={1} onChange={value => updateTint('r', value)} />
          <TunerRange label="Tint green" value={optics.tint.g} min={0} max={255} step={1} onChange={value => updateTint('g', value)} />
          <TunerRange label="Tint blue" value={optics.tint.b} min={0} max={255} step={1} onChange={value => updateTint('b', value)} />

          <div className="ui-kit-liquid-glass-surface__section-heading">
            <Text variant="headline">Optics</Text>
          </div>
          <TunerRange label="Refraction" value={optics.refraction} min={0} max={20} step={0.1} format={value => value.toFixed(1)} onChange={value => update('refraction', value)} />
          <TunerRange label="RGB spread" value={optics.rgbSpread} min={0} max={2} step={0.05} format={value => value.toFixed(2)} onChange={value => update('rgbSpread', value)} />
          <TunerRange label="Neutral edge" value={optics.neutralEdge} min={0} max={6} step={0.1} format={value => value.toFixed(1)} onChange={value => update('neutralEdge', value)} />
          <TunerRange label="Rim width" value={optics.rimWidth} min={1} max={20} step={0.5} format={value => value.toFixed(1)} onChange={value => update('rimWidth', value)} />
          <TunerRange label="Rim strength" value={optics.rimStrength} min={0} max={1.5} step={0.01} format={value => value.toFixed(2)} onChange={value => update('rimStrength', value)} />
          <TunerRange label="Trench width" value={optics.trenchWidth} min={0} max={8} step={0.25} format={value => value.toFixed(2)} onChange={value => update('trenchWidth', value)} />
          <TunerRange label="Trench strength" value={optics.trenchStrength} min={0} max={0.6} step={0.01} format={value => value.toFixed(2)} onChange={value => update('trenchStrength', value)} />

          <div className="ui-kit-liquid-glass-surface__section-heading">
            <Text variant="headline">Edges</Text>
          </div>
          <TunerRange label="Bezel" value={optics.bezelOpacity} min={0} max={1} step={0.01} format={value => value.toFixed(2)} onChange={value => update('bezelOpacity', value)} />
          <TunerRange label="Border" value={optics.borderOpacity} min={0} max={0.5} step={0.01} format={value => value.toFixed(2)} onChange={value => update('borderOpacity', value)} />
          <TunerRange label="Shadow" value={optics.shadowOpacity} min={0} max={0.5} step={0.01} format={value => value.toFixed(2)} onChange={value => update('shadowOpacity', value)} />
          <TunerRange label="Corner radius" value={radius} min={0} max={80} step={1} format={value => `${value}px`} onChange={value => { setSelectedPreset('custom'); setRadius(value); }} />
        </div>
      </div>
    </section>
  );
}
