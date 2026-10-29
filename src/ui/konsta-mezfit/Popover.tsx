// Konsta 5.4.0 Mezfit edition: preserve Popover mechanics; replace only the inner iOS Glass renderer.
/* eslint-disable no-restricted-globals */
import { createPortal } from 'react-dom';
import './popover.css';
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
} from 'react';
import { Glass as KonstaGlass, Popover as KonstaPopover, useTheme } from 'konsta/react';
import { PopoverClasses } from 'konsta/shared/classes';
import { PopoverColors } from 'konsta/shared/colors';
import { calcPopoverPosition, cls, useIosHighlight } from 'konsta/shared/utils';
import { GlassSurface } from '../GlassSurface';
import type {
  GlassMaterialOverrides,
  GlassPresetName,
  GlassShape,
} from '../glassMaterial';

export type MezfitPopoverProps = ComponentProps<typeof KonstaPopover> & {
  glassPreset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  glassShape?: GlassShape;
  iosHighlight?: boolean;
  /** Custom owns its surface and opening animation; shared placement/backdrop stay here. */
  presentation?: 'standard' | 'custom';
  /** Render through a React portal without losing theme/context. */
  portal?: boolean;
  /** Fixed, horizontally centered surface at this CSS-pixel viewport offset. */
  viewportTop?: number;
  /** Allow native vertical panning through the surface to scrollable children. */
  scrollable?: boolean;
  onPositioned?: (element: HTMLElement) => void;
};

type MezfitPopoverPosition = {
  set: boolean;
  angleTop?: string | number;
  angleLeft?: string | number;
  anglePosition: 'top' | 'bottom' | 'left' | 'right';
  popoverTop: string | number;
  popoverLeft: string | number;
  popoverPosition:
    | 'top-left'
    | 'top-right'
    | 'middle-left'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-right';
};

const canonicalDark = (classNames: string) => classNames;

export function MezfitPopover(props: MezfitPopoverProps) {
  const {
    component = 'div',
    className,
    angle = false,
    angleClassName = '',
    colors: colorsProp,
    opened,
    backdrop = true,
    onBackdropClick,
    target,
    targetX,
    targetY,
    targetWidth,
    targetHeight,
    glassPreset = 'modalTuned',
    glass,
    glassShape = 'auto',
    iosHighlight = true,
    presentation = 'standard',
    portal = false,
    onPositioned,
    viewportTop,
    scrollable = false,

    children,
    style = {},
    ref,
    ...rest
  } = props;

  const elRef = useRef<HTMLElement | null>(null);
  const setRootRef = useCallback((element: HTMLElement | null) => {
    elRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  }, [ref]);
  const angleElRef = useRef<HTMLDivElement | null>(null);
  const glassRef = useRef<HTMLElement | null>(null);
  const highlightData = useRef<Record<string, unknown>>({});
  const [positions, setPositions] = useState<MezfitPopoverPosition>({
    set: false,
    angleTop: 0,
    angleLeft: 0,
    anglePosition: 'bottom',
    popoverTop: 0,
    popoverLeft: 0,
    popoverPosition: 'top-left',
  });

  const lastNotifiedPosition = useRef<MezfitPopoverPosition | null>(null);
  useLayoutEffect(() => {
    if (!opened) { lastNotifiedPosition.current = positions; return; }
    if (positions.set && positions !== lastNotifiedPosition.current && elRef.current) {
      lastNotifiedPosition.current = positions;
      onPositioned?.(elRef.current);
    }
  }, [positions, opened, onPositioned]);

  const state = opened ? 'opened' : 'closed';
  const Component = component as ElementType;
  const attrs = { ...rest };

  const theme = useTheme();
  const colors = PopoverColors(colorsProp, canonicalDark);
  const c = PopoverClasses({ ...props, angleClassName }, colors, canonicalDark);
  const { attachEvents: attachHighlight, detachEvents: detachHighlight } = useIosHighlight({
    getEl: () => glassRef.current,
    enabled: presentation === 'standard' && theme === 'ios' && iosHighlight,
    data: highlightData.current,
  });

  const setPopover = () => {
    if (!elRef.current || !opened) return;
    if (viewportTop !== undefined) {
      const view = elRef.current.ownerDocument.defaultView ?? window;
      setPositions({
        set: true,
        anglePosition: 'top',
        popoverTop: viewportTop,
        popoverLeft: Math.max(12, (view.innerWidth - elRef.current.offsetWidth) / 2),
        popoverPosition: 'bottom-left',
      });
      return;
    }
    if (!target) return;
    setPositions(
      calcPopoverPosition({
        popoverEl: elRef.current,
        targetEl: target,
        angleEl: angleElRef.current,
        needsAngle: angle,
        targetX,
        targetY,
        targetHeight,
        targetWidth,
        theme,
      }),
    );
  };

  const attachEvents = () => {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', setPopover);
  };

  const detachEvents = () => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('resize', setPopover);
  };

  useEffect(() => {
    attachEvents();
    return () => detachEvents();
  });

  useEffect(() => {
    attachHighlight();
    return () => detachHighlight();
  });

  useEffect(() => {
    setPopover();
  }, [opened, target, targetX, targetY, targetWidth, targetHeight, viewportTop]);

  const popoverStyle = positions.set
    ? {
        ...(style || {}),
        position: viewportTop !== undefined ? 'fixed' as const : style.position,
        touchAction: scrollable ? 'pan-y' : style.touchAction,
        left: positions.popoverLeft,
        top: positions.popoverTop,
      }
    : { ...style, ...(viewportTop !== undefined ? { position: 'fixed' as const, top: viewportTop } : {}), ...(scrollable ? { touchAction: 'pan-y' } : {}) };

  const angleStyle = positions.set
    ? {
        left: positions.angleLeft,
        top: positions.angleTop,
      }
    : undefined;

  const originClasses: Record<string, string> = {
    'top-right': 'origin-bottom-left',
    'top-left': 'origin-bottom-right',
    'middle-left': 'origin-right',
    'middle-right': 'origin-left',
    'bottom-right': 'origin-top-left',
    'bottom-left': 'origin-top-right',
  };

  const classes = cls(
    c.base.common,
    c.base[theme],
    c.base[state].common,
    c.base[state][theme],
    className,
    originClasses[positions.popoverPosition],
  );
  const backdropClasses = cls(c.backdrop.common, c.backdrop[state]);
  const innerClasses = cls(
    c.inner.common,
    c.inner[theme],
    c.inner[state].common,
    c.inner[state][theme],
  );

  const content = (
    <>
      {backdrop && (
        <div className={backdropClasses} onClick={onBackdropClick} />
      )}

      <Component
        ref={setRootRef}
        className={presentation === 'custom' ? cls('ui-mezfit-popover-custom', className) : classes}
        hidden={presentation === 'custom' && !opened ? true : undefined}
        style={popoverStyle}
        {...attrs}
      >
        {angle && (
          <div
            ref={angleElRef}
            style={angleStyle}
            className={cls(
              c.angleWrap.common,
              c.angleWrap[theme],
              c.angleWrap[positions.anglePosition],
            )}
          >
            <div
              className={cls(
                c.angleArrow.common,
                c.angleArrow[theme],
                c.angleArrow[positions.anglePosition],
              )}
            />
          </div>
        )}
        {presentation === 'custom' ? children : theme === 'ios' ? (
          <GlassSurface
            ref={glassRef}
            className={cls('k-glass', scrollable ? 'touch-pan-y' : 'touch-none', innerClasses)}
            style={scrollable ? { touchAction: 'pan-y' } : undefined}
            preset={glassPreset}
            glass={glass}
            shape={glassShape}
            wrapContent={false}
          >
            {children}
          </GlassSurface>
        ) : (
          <KonstaGlass className={innerClasses}>{children}</KonstaGlass>
        )}
      </Component>
    </>
  );
  return portal && typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}

MezfitPopover.displayName = 'MezfitPopover';
