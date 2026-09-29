// Konsta 5.4.0 Mezfit edition: preserve Panel mechanics; replace only the iOS floating Glass renderer.
import {
  useRef,
  type ComponentProps,
  type ElementType,
} from 'react';
import { Panel as KonstaPanel } from 'konsta/react';
import { PanelClasses } from 'konsta/shared/classes';
import { PanelColors } from 'konsta/shared/colors';
import { cls } from 'konsta/shared/utils';
import { GlassSurface } from '../GlassSurface';
import type {
  GlassMaterialOverrides,
  GlassPresetName,
  GlassShape,
} from '../glassMaterial';

export type MezfitPanelProps = ComponentProps<typeof KonstaPanel> & {
  glassPreset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  glassShape?: GlassShape;
};

const canonicalDark = (classNames: string) => classNames;

export function MezfitPanel(props: MezfitPanelProps) {
  const {
    component = 'div',
    className,
    colors: colorsProp,

    side = 'left',
    opened,
    backdrop = true,
    floating = false,
    onBackdropClick,

    ios: _ios,
    material: _material,

    glassPreset = 'modalTuned',
    glass,
    glassShape = 'auto',

    children,
    ref,
    ...rest
  } = props;

  const elRef = useRef<HTMLElement | null>(null);
  const state = opened ? 'opened' : 'closed';
  const Component = component as ElementType;
  const attrs = { ...rest };

  const colors = PanelColors(colorsProp, canonicalDark);
  const c = PanelClasses({ ...props, floating }, colors);

  const classes = cls(
    c.base.common,
    c.base.ios,
    className,
    c[side].common,
    c[side][state],
  );
  const backdropClasses = cls(c.backdrop.common, c.backdrop[state]);

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
      {floating ? (
        <GlassSurface
          component={Component}
          ref={setRef}
          className={cls('k-glass touch-none', classes)}
          preset={glassPreset}
          glass={glass}
          shape={glassShape}
          wrapContent={false}
          {...attrs}
        >
          {children}
        </GlassSurface>
      ) : (
        <Component ref={setRef} className={classes} {...attrs}>
          {children}
        </Component>
      )}
    </>
  );
}

MezfitPanel.displayName = 'MezfitPanel';
