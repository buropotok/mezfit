/* eslint-disable no-restricted-globals */
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
} from 'react';
import {
  Popover as KonstaPopover,
  useTheme,
  useThemeClasses,
} from 'konsta/react';
import { PopoverClasses } from 'konsta/shared/classes';
import { PopoverColors } from 'konsta/shared/colors';
import { calcPopoverPosition, cls } from 'konsta/shared/utils';
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
    ios,
    material,

    glassPreset = 'modalTuned',
    glass,
    glassShape = 'auto',

    children,
    style = {},
    ref,
    ...rest
  } = props;

  const elRef = useRef<HTMLElement | null>(null);
  const angleElRef = useRef<HTMLDivElement | null>(null);
  const [positions, setPositions] = useState({
    set: false,
    angleTop: 0 as string | number | undefined,
    angleLeft: 0 as string | number | undefined,
    anglePosition: 'bottom',
    popoverTop: 0 as string | number,
    popoverLeft: 0 as string | number,
    popoverPosition: 'top-left',
  });

  const state = opened ? 'opened' : 'closed';
  const Component = component as ElementType;
  const attrs = { ...rest };

  const theme = useTheme({ ios, material });
  const themeClasses = useThemeClasses({ ios, material });
  const colors = PopoverColors(colorsProp, canonicalDark);

  const c = themeClasses(
    PopoverClasses({ ...props, angleClassName }, colors, canonicalDark),
    className,
  );

  const setPopover = () => {
    if (!target || !elRef.current || !opened) return;
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
    setPopover();
  }, [opened]);

  const popoverStyle = positions.set
    ? {
        ...(style || {}),
        left: positions.popoverLeft,
        top: positions.popoverTop,
      }
    : style;

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
    c.base[state],
    originClasses[positions.popoverPosition],
  );

  return (
    <>
      {backdrop && (
        <div className={c.backdrop[state]} onClick={onBackdropClick} />
      )}

      <Component
        ref={(element: HTMLElement | null) => {
          elRef.current = element;
          if (typeof ref === 'function') ref(element);
          else if (ref) ref.current = element;
        }}
        className={classes}
        style={popoverStyle}
        {...attrs}
      >
        {angle && (
          <div
            ref={angleElRef}
            style={angleStyle}
            className={c.angleWrap[positions.anglePosition]}
          >
            <div className={c.angleArrow[positions.anglePosition]} />
          </div>
        )}
        <GlassSurface
          className={c.inner[state]}
          preset={glassPreset}
          glass={glass}
          shape={glassShape}
          wrapContent={false}
        >
          {children}
        </GlassSurface>
      </Component>
    </>
  );
}

MezfitPopover.displayName = 'MezfitPopover';
