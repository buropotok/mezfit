import {
  useEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
  type TransitionEventHandler,
} from 'react';
import { createPortal } from 'react-dom';
import { GlassSurface } from './GlassSurface';
import type {
  GlassMaterialOverrides,
  GlassPresetName,
  GlassShape,
} from './glassMaterial';
import './glass-overlays.css';

type GlassPanelStyle = CSSProperties & {
  '--ui-glass-panel-width'?: string;
};

export type GlassPanelProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  opened: boolean;
  children: ReactNode;
  side?: 'left' | 'right';
  backdrop?: boolean;
  onBackdropClick?: MouseEventHandler<HTMLDivElement>;
  width?: CSSProperties['width'];
  preset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  shape?: GlassShape;
  surfaceClassName?: string;
  contentClassName?: string;
};

export function GlassPanel({
  opened,
  children,
  side = 'right',
  backdrop = true,
  onBackdropClick,
  width = '18rem',
  preset = 'modalTuned',
  glass,
  shape = 'auto',
  className = '',
  surfaceClassName = '',
  contentClassName = '',
  style,
  onTransitionEnd,
  ...props
}: GlassPanelProps) {
  const [glassActive, setGlassActive] = useState(opened);

  useEffect(() => {
    if (opened) {
      setGlassActive(true);
      return;
    }

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setGlassActive(false);
    }
  }, [opened]);

  if (typeof document === 'undefined') return null;

  const state = opened ? 'opened' : 'closed';
  const handleTransitionEnd: TransitionEventHandler<HTMLDivElement> = (event) => {
    onTransitionEnd?.(event);
    if (!opened && event.target === event.currentTarget && event.propertyName === 'transform') {
      setGlassActive(false);
    }
  };
  const panelStyle: GlassPanelStyle = {
    ...style,
    '--ui-glass-panel-width': typeof width === 'number' ? `${width}px` : width,
  };

  return createPortal(
    <>
      {backdrop ? (
        <div
          className="ui-glass-overlay-backdrop"
          data-state={state}
          aria-hidden="true"
          onClick={opened ? onBackdropClick : undefined}
        />
      ) : null}
      <div
        {...props}
        className={`ui-glass-panel ui-glass-panel--${side} ${className}`.trim()}
        data-state={state}
        style={panelStyle}
        onTransitionEnd={handleTransitionEnd}
      >
        <GlassSurface
          active={glassActive}
          preset={preset}
          glass={glass}
          shape={shape}
          className={`ui-glass-panel__surface ${surfaceClassName}`.trim()}
          contentClassName={`ui-glass-panel__content ${contentClassName}`.trim()}
        >
          {children}
        </GlassSurface>
      </div>
    </>,
    document.body,
  );
}
