import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { GlassSurface } from './GlassSurface';
import type {
  GlassMaterialOverrides,
  GlassPresetName,
  GlassShape,
} from './glassMaterial';
import './glass-overlays.css';

type GlassPopoverPosition = {
  left: number;
  top: number;
  ready: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type GlassPopoverProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  opened: boolean;
  target: HTMLElement | null | undefined;
  children: ReactNode;
  backdrop?: boolean;
  onBackdropClick?: MouseEventHandler<HTMLDivElement>;
  gap?: number;
  viewportPadding?: number;
  preset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  shape?: GlassShape;
  surfaceClassName?: string;
  contentClassName?: string;
};

export function GlassPopover({
  opened,
  target,
  children,
  backdrop = true,
  onBackdropClick,
  gap = 8,
  viewportPadding = 12,
  preset = 'modalTuned',
  glass,
  shape = 'auto',
  className = '',
  surfaceClassName = '',
  contentClassName = '',
  style,
  ...props
}: GlassPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<GlassPopoverPosition>({
    left: 0,
    top: 0,
    ready: false,
  });

  const updatePosition = useCallback(() => {
    const element = containerRef.current;
    if (!opened || !target || !element || typeof window === 'undefined') {
      setPosition((current) => current.ready ? { ...current, ready: false } : current);
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const popoverRect = element.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const availableBelow = viewportBottom - targetRect.bottom - gap - viewportPadding;
    const availableAbove = targetRect.top - viewportTop - gap - viewportPadding;
    const placeBelow = popoverRect.height <= availableBelow || availableBelow >= availableAbove;

    const idealLeft = targetRect.left + targetRect.width / 2 - popoverRect.width / 2;
    const maxLeft = Math.max(viewportLeft + viewportPadding, viewportRight - popoverRect.width - viewportPadding);
    const left = clamp(idealLeft, viewportLeft + viewportPadding, maxLeft);

    const idealTop = placeBelow
      ? targetRect.bottom + gap
      : targetRect.top - popoverRect.height - gap;
    const maxTop = Math.max(viewportTop + viewportPadding, viewportBottom - popoverRect.height - viewportPadding);
    const top = clamp(idealTop, viewportTop + viewportPadding, maxTop);

    setPosition((current) => (
      Math.abs(current.left - left) < 0.5
      && Math.abs(current.top - top) < 0.5
      && current.ready
        ? current
        : { left, top, ready: true }
    ));
  }, [gap, opened, target, viewportPadding]);

  useLayoutEffect(() => {
    if (!opened || !target || typeof window === 'undefined') {
      setPosition((current) => current.ready ? { ...current, ready: false } : current);
      return undefined;
    }

    updatePosition();

    const handleViewportChange = () => updatePosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updatePosition);
    if (observer) {
      if (containerRef.current) observer.observe(containerRef.current);
      observer.observe(target);
    }

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      observer?.disconnect();
    };
  }, [opened, target, updatePosition]);

  if (typeof document === 'undefined') return null;

  const state = opened ? 'opened' : 'closed';
  const positionedStyle: CSSProperties = {
    ...style,
    left: position.left,
    top: position.top,
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
        ref={containerRef}
        className={`ui-glass-popover ${className}`.trim()}
        data-state={state}
        data-ready={position.ready ? 'true' : 'false'}
        style={positionedStyle}
      >
        <GlassSurface
          active={opened && position.ready}
          preset={preset}
          glass={glass}
          shape={shape}
          className={`ui-glass-popover__surface ${surfaceClassName}`.trim()}
          contentClassName={`ui-glass-popover__content ${contentClassName}`.trim()}
        >
          {children}
        </GlassSurface>
      </div>
    </>,
    document.body,
  );
}
