import type { CSSProperties } from 'react';
import { LiquidGlassContainer } from '@tinymomentum/liquid-glass-react';
import '@tinymomentum/liquid-glass-react/dist/components/LiquidGlassBase.css';

type LiquidGlassMaterialProps = {
  width: number;
  height: number;
  borderRadius: number;
  className?: string;
  style?: CSSProperties;
};

export function LiquidGlassMaterial({
  width,
  height,
  borderRadius,
  className = '',
  style,
}: LiquidGlassMaterialProps) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safeRadius = Math.max(0, Math.min(borderRadius, safeWidth / 2, safeHeight / 2));

  return (
    <div
      className={`ui-liquid-glass-material ${className}`.trim()}
      style={{ ...style, width: safeWidth, height: safeHeight, borderRadius: safeRadius }}
      aria-hidden="true"
    >
      <LiquidGlassContainer width={safeWidth} height={safeHeight} borderRadius={safeRadius}>
        <span className="ui-liquid-glass-material__content" />
      </LiquidGlassContainer>
    </div>
  );
}
