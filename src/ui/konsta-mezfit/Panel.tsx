// Konsta 5.4.0 Mezfit edition: preserve Side Panel mechanics; replace only the iOS floating Glass renderer.
import {
  useRef,
  type ComponentProps,
  type ElementType,
} from 'react';
import { Panel as KonstaPanel, useTheme } from 'konsta/react';
import { PanelClasses } from 'konsta/shared/classes';
import { PanelColors } from 'konsta/shared/colors';
import { cls } from 'konsta/shared/utils';
import { GlassSurface } from '../GlassSurface';
import type {
  GlassMaterialOverrides,
  GlassPresetName,
  GlassShape,
} from '../glassMaterial';

export type MezfitSidePanelSurface = 'glass' | 'bare';

export type MezfitSidePanelProps = ComponentProps<typeof KonstaPanel> & {
  glassPreset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  glassShape?: GlassShape;
  surface?: MezfitSidePanelSurface;
  backdropClassName?: string;
};

const canonicalDark = (classNames: string) => classNames;

export type MezfitPanelProps = MezfitSidePanelProps;

export function MezfitSidePanel(props: MezfitSidePanelProps) {
  const {
    component = 'div',
    className,
    colors: colorsProp,

    side = 'left',
    opened,
    backdrop = true,
    floating = false,
    onBackdropClick,

    glassPreset = 'modalTuned',
    glass,
    glassShape = 'auto',
    surface = 'glass',
    backdropClassName,

    children,
    ref,
    style,
    ...rest
  } = props;

  const elRef = useRef<HTMLElement | null>(null);
  const state = opened ? 'opened' : 'closed';
  const Component = component as ElementType;
  const attrs = { ...rest };

  const theme = useTheme();
  const colors = PanelColors(colorsProp, canonicalDark);
  const c = PanelClasses({ ...props, floating }, colors);

  const classes = cls(
    c.base.common,
    surface === 'bare' && theme === 'ios' ? undefined : c.base[theme],
    className,
    c[side].common,
    c[side][theme],
    c[side][state],
  );
  const backdropClasses = cls(c.backdrop.common, c.backdrop[state], backdropClassName);

  const setRef = (element: HTMLElement | null) => {
    elRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  return (
    <>
      {backdrop && (
        <div className={backdropClasses} onClick={onBackdropClick} />
      )}
      {theme === 'ios' && floating && surface === 'glass' ? (
        <GlassSurface
          component={Component}
          ref={setRef}
          className={cls('k-glass touch-none', classes)}
          preset={glassPreset}
          glass={glass}
          shape={glassShape}
          wrapContent={false}
          style={{
            ...style,
            willChange: style?.willChange ?? 'transform',
          }}
          {...attrs}
        >
          {children}
        </GlassSurface>
      ) : (
        <Component ref={setRef} className={classes} style={style} {...attrs}>
          {children}
        </Component>
      )}
    </>
  );
}

MezfitSidePanel.displayName = 'MezfitSidePanel';

export const MezfitPanel = MezfitSidePanel;
