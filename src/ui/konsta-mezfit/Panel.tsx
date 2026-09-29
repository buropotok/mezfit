import {
  useRef,
  type ComponentProps,
  type ElementType,
} from 'react';
import {
  Panel as KonstaPanel,
  useTheme,
  useThemeClasses,
} from 'konsta/react';
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

    ios,
    material,

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

  const theme = useTheme({ ios, material });
  const themeClasses = useThemeClasses({ ios, material });
  const colors = PanelColors(colorsProp, canonicalDark);

  const c = themeClasses(
    PanelClasses({ ...props, floating }, colors),
    className,
  );

  const classes = cls(c.base, c[side][state]);

  const setRef = (element: HTMLElement | null) => {
    elRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  return (
    <>
      {backdrop && (
        <div className={c.backdrop[state]} onClick={onBackdropClick} />
      )}
      {theme === 'ios' && floating ? (
        <GlassSurface
          component={Component}
          ref={setRef}
          className={classes}
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
