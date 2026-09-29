import {
  useCallback,
  useLayoutEffect,
  useRef,
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

type GlassPopoverPosition = {
  left: number;
  top: number;
  maxWidth: number | null;
  ready: boolean;
};

type GlassPopoverStyle = CSSProperties & {
  '--ui-glass-overlay-backdrop-z'?: string;
  '--ui-glass-overlay-surface-z'?: string;
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
  layer?: number;
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
  layer = 50,
  preset = 'modalTuned',
  glass,
  shape = 'auto',
  className = '',
  surfaceClassName = '',
  contentClassName = '',
  style,
  onTransitionEnd,
  ...props
}: GlassPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [glassActive, setGlassActive] = useState(opened);
  const [position, setPosition] = useState<GlassPopoverPosition>({
    left: 0,
    top: 0,
    maxWidth: null,
    ready: false,
  });

  useLayoutEffect(() => {
    if (opened && target) {
      setGlassActive(true);
      return;
    }

    if (opened && !target) {
      setGlassActive(false);
      setPosition((current) => current.ready ? { ...current, ready: false } : current);
      return;
    }

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setGlassActive(false);
      setPosition((current) => current.ready ? { ...current, ready: false } : current);
    }
  }, [opened, target]);

  const updatePosition = useCallback(() => {
    const element = containerRef.current;
    if (!opened || !target || !element || typeof window === 'undefined') return;

    const targetRect = target.getBoundingClientRect();
    const transformedRect = element.getBoundingClientRect();
    const layoutWidth = element.offsetWidth || transformedRect.width;
    const popoverHeight = element.offsetHeight || transformedRect.height;
    const computedStyle = window.getComputedStyle(element);
    const safeLeft = Number.parseFloat(computedStyle.getPropertyValue('--ui-glass-safe-area-left')) || 0;
    const safeRight = Number.parseFloat(computedStyle.getPropertyValue('--ui-glass-safe-area-right')) || 0;
    const safeTop = Number.parseFloat(computedStyle.getPropertyValue('--ui-glass-safe-area-top')) || 0;
    const safeBottom = Number.parseFloat(computedStyle.getPropertyValue('--ui-glass-safe-area-bottom')) || 0;
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const minLeft = viewportLeft + safeLeft + viewportPadding;
    const minTop = viewportTop + safeTop + viewportPadding;
    const maxRight = viewportRight - safeRight - viewportPadding;
    const maxBottom = viewportBottom - safeBottom - viewportPadding;
    const availableWidth = Math.max(0, maxRight - minLeft);
    const popoverWidth = Math.min(layoutWidth, availableWidth);
    const availableBelow = maxBottom - targetRect.bottom - gap;
    const availableAbove = targetRect.top - minTop - gap;
    const placeBelow = popoverHeight <= availableBelow || availableBelow >= availableAbove;

    const idealLeft = targetRect.left + targetRect.width / 2 - popoverWidth / 2;
    const maxLeft = Math.max(minLeft, maxRight - popoverWidth);
    const left = clamp(idealLeft, minLeft, maxLeft);

    const idealTop = placeBelow
      ? targetRect.bottom + gap
      : targetRect.top - popoverHeight - gap;
    const maxTop = Math.max(minTop, maxBottom - popoverHeight);
    const top = clamp(idealTop, minTop, maxTop);

    setPosition((current) => (
      Math.abs(current.left - left) < 0.5
      && Math.abs(current.top - top) < 0.5
      && current.maxWidth === availableWidth
      && current.ready
        ? current
        : { left, top, maxWidth: availableWidth, ready: true }
    ));
  }, [gap, opened, target, viewportPadding]);

  useLayoutEffect(() => {
    if (!opened || !target || typeof window === 'undefined') return undefined;

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

  const state = opened && target ? 'opened' : 'closed';
  const handleTransitionEnd: TransitionEventHandler<HTMLDivElement> = (event) => {
    onTransitionEnd?.(event);
    if (!opened && event.target === event.currentTarget && event.propertyName === 'transform') {
      setGlassActive(false);
      setPosition((current) => current.ready ? { ...current, ready: false } : current);
    }
  };
  const positionedStyle: GlassPopoverStyle = {
    ...style,
    left: position.left,
    top: position.top,
    maxWidth: position.maxWidth ?? style?.maxWidth,
    '--ui-glass-overlay-backdrop-z': String(layer),
    '--ui-glass-overlay-surface-z': String(layer + 1),
  };

  return createPortal(
    <>
      {backdrop ? (
        <div
          className="ui-glass-overlay-backdrop"
          data-state={state}
          aria-hidden="true"
          style={{
            '--ui-glass-overlay-backdrop-z': String(layer),
          } as CSSProperties}
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
        onTransitionEnd={handleTransitionEnd}
      >
        <GlassSurface
          active={glassActive && position.ready}
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
