/* eslint-disable no-restricted-globals */
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
} from 'react';
import { Popover as KonstaPopover } from 'konsta/react';
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
    ios: _ios,
    material: _material,

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
  const [positions, setPositions] = useState<MezfitPopoverPosition>({
    set: false,
    angleTop: 0,
    angleLeft: 0,
    anglePosition: 'bottom',
    popoverTop: 0,
    popoverLeft: 0,
    popoverPosition: 'top-left',
  });

  const state = opened ? 'opened' : 'closed';
  const Component = component as ElementType;
  const attrs = { ...rest };

  const colors = PopoverColors(colorsProp, canonicalDark);
  const c = PopoverClasses({ ...props, angleClassName }, colors, canonicalDark);

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
        theme: 'ios',
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
    c.base.common,
    c.base.ios,
    c.base[state].common,
    c.base[state].ios,
    className,
    originClasses[positions.popoverPosition],
  );
  const backdropClasses = cls(c.backdrop.common, c.backdrop[state]);
  const innerClasses = cls(
    c.inner.common,
    c.inner.ios,
    c.inner[state].common,
    c.inner[state].ios,
  );

  return (
    <>
      {backdrop && (
        <div className={backdropClasses} onClick={onBackdropClick} />
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
            className={cls(
              c.angleWrap.common,
              c.angleWrap.ios,
              c.angleWrap[positions.anglePosition],
            )}
          >
            <div
              className={cls(
                c.angleArrow.common,
                c.angleArrow.ios,
                c.angleArrow[positions.anglePosition],
              )}
            />
          </div>
        )}
        <GlassSurface
          className={innerClasses}
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
