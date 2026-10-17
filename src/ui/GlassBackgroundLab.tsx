import { Range as KonstaRange } from 'konsta/react';
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Button, Divider, GlassSurface, Surface, Text } from './index';
import { hsvToHex, type HsvColor } from './colorMath';
export { hsvToHex } from './colorMath';
import './GlassBackgroundLab.css';

const RECOMMENDED_COLOR: HsvColor = {
  hue: 219,
  saturation: 56,
  value: 43,
};

export const RECOMMENDED_GLASS_BACKGROUND = '#30466E';

/** Controlled form of the same UI Kit color wheel used by GlassBackgroundLab. */
export function GlassBackgroundColorControls({
  color,
  onChange,
  minimumBrightness = 20,
  children,
}: {
  color: HsvColor;
  onChange: (color: HsvColor) => void;
  minimumBrightness?: number;
  children?: ReactNode;
}) {
  const brightnessId = useId();
  const activePointerId = useRef<number | null>(null);
  const markerAngle = color.hue * Math.PI / 180;
  const markerRadius = color.saturation / 100 * 50;
  const markerStyle = {
    left: `${50 + Math.sin(markerAngle) * markerRadius}%`,
    top: `${50 - Math.cos(markerAngle) * markerRadius}%`,
  };

  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const saturation = Math.min(100, Math.hypot(dx, dy) / radius * 100);
    const hue = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;

    onChange({ ...color, hue, saturation });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    activePointerId.current = event.pointerId;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    updateFromPointer(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    updateFromPointer(event);
  };

  const releasePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const backgroundColor = hsvToHex(color);
  return (
        <div className="glass-background-lab__controls">
          <div className="glass-background-lab__wheel-wrap">
            <Text variant="footnote" tone="muted">Оттенок и насыщенность</Text>
            <button
              type="button"
              className="glass-background-lab__wheel"
              aria-label={`Выбрать цвет фона. Оттенок ${Math.round(color.hue)}°, насыщенность ${Math.round(color.saturation)}%`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={releasePointer}
              onPointerCancel={releasePointer}
              onLostPointerCapture={() => {
                activePointerId.current = null;
              }}
            >
              <span className="glass-background-lab__wheel-marker" style={markerStyle} aria-hidden="true" />
            </button>
          </div>
          <div className="glass-background-lab__brightness">
            <div className="glass-background-lab__brightness-control">
              <label htmlFor={brightnessId}>
                <Text variant="footnote" tone="muted">Яркость · {Math.round(color.value)}%</Text>
              </label>
              <KonstaRange
                inputId={brightnessId}
                min={minimumBrightness}
                max={100}
                step={1}
                value={color.value}
                onChange={(event) => {
                  onChange({ ...color, value: Number(event.target.value) });
                }}
              />
            </div>
            <div className="glass-background-lab__value">
              <span className="glass-background-lab__swatch" style={{ backgroundColor }} aria-hidden="true" />
              <Text>{backgroundColor}</Text>
            </div>
            {children}
          </div>
        </div>
  );
}

export function GlassBackgroundLab() {
  const [color, setColor] = useState<HsvColor>(RECOMMENDED_COLOR);
  const backgroundColor = hsvToHex(color);
  return (
    <Surface as="section" className="ui-kit-section">
      <div className="glass-background-lab">
        <div className="ui-kit-stack">
          <Text variant="title">GlassSurface · background lab</Text>
          <Text variant="caption" tone="muted">
            Тапайте по цветовому кругу и меняйте яркость, чтобы проверить штатный GlassSurface на разных фонах.
          </Text>
        </div>
        <Divider />
        <div className="glass-background-lab__stage" style={{ backgroundColor }}>
          <div className="glass-background-lab__stage-art" aria-hidden="true" />
          <GlassSurface
            className="glass-background-lab__tile"
            contentClassName="glass-background-lab__tile-content"
          >
            <Text variant="headline">GlassSurface</Text>
            <Text tone="muted">Modal Tuned · default material</Text>
          </GlassSurface>
        </div>
        <GlassBackgroundColorControls color={color} onChange={setColor}>
            <Text variant="caption" tone="muted">
              Мой стартовый вариант — {RECOMMENDED_GLASS_BACKGROUND}: глубокий сине-серый фон, который подчёркивает стекло без лишней насыщенности.
            </Text>
            <div>
              <Button
                variant="secondary"
                onClick={() => {
                  setColor(RECOMMENDED_COLOR);
                }}
              >
                Вернуть рекомендованный
              </Button>
            </div>
        </GlassBackgroundColorControls>
      </div>
    </Surface>
  );
}
