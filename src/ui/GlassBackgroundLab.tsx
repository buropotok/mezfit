import { Range as KonstaRange } from 'konsta/react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Divider, GlassSurface, Surface, Text } from './index';
import './GlassBackgroundLab.css';

type HsvColor = {
  hue: number;
  saturation: number;
  value: number;
};

const RECOMMENDED_COLOR: HsvColor = {
  hue: 219,
  saturation: 56,
  value: 43,
};

export const RECOMMENDED_GLASS_BACKGROUND = '#30466E';

function toHexChannel(value: number) {
  return Math.round(value).toString(16).padStart(2, '0');
}

export function hsvToHex({ hue, saturation, value }: HsvColor) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const v = Math.max(0, Math.min(100, value)) / 100;
  const chroma = v * s;
  const hueSector = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((hueSector % 2) - 1));
  const offset = v - chroma;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hueSector < 1) [r, g, b] = [chroma, x, 0];
  else if (hueSector < 2) [r, g, b] = [x, chroma, 0];
  else if (hueSector < 3) [r, g, b] = [0, chroma, x];
  else if (hueSector < 4) [r, g, b] = [0, x, chroma];
  else if (hueSector < 5) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return `#${toHexChannel((r + offset) * 255)}${toHexChannel((g + offset) * 255)}${toHexChannel((b + offset) * 255)}`.toUpperCase();
}

export function GlassBackgroundLab() {
  const [color, setColor] = useState<HsvColor>(RECOMMENDED_COLOR);
  const activePointerId = useRef<number | null>(null);
  const backgroundColor = hsvToHex(color);
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

    setColor(current => ({ ...current, hue, saturation }));
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
              <label htmlFor="glass-background-brightness">
                <Text variant="footnote" tone="muted">Яркость · {Math.round(color.value)}%</Text>
              </label>
              <KonstaRange
                inputId="glass-background-brightness"
                min={20}
                max={100}
                step={1}
                value={color.value}
                onChange={(event) => {
                  setColor(current => ({ ...current, value: Number(event.target.value) }));
                }}
              />
            </div>
            <div className="glass-background-lab__value">
              <span className="glass-background-lab__swatch" style={{ backgroundColor }} aria-hidden="true" />
              <Text>{backgroundColor}</Text>
            </div>
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
          </div>
        </div>
      </div>
    </Surface>
  );
}
