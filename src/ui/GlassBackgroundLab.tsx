import { useState } from 'react';
import { Button, Divider, Surface, Text } from './primitives';
import { GlassSurface } from './GlassSurface';
import { GlassBackgroundColorControls } from './GlassBackgroundColorControls';
import { hsvToHex, type HsvColor } from './colorMath';
import './GlassBackgroundLab.css';

export { hsvToHex } from './colorMath';

const RECOMMENDED_COLOR: HsvColor = {
  hue: 219,
  saturation: 56,
  value: 43,
};

export const RECOMMENDED_GLASS_BACKGROUND = '#30466E';

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
