// Konsta 5.4.0 Mezfit edition: preserve Dialog mechanics; replace only the Glass renderer.
import {
  useRef,
  type ComponentProps,
  type ElementType,
} from 'react';
import { Dialog as KonstaDialog, Glass as KonstaGlass, useTheme } from 'konsta/react';
import { DialogClasses } from 'konsta/shared/classes';
import { DialogColors } from 'konsta/shared/colors';
import { cls } from 'konsta/shared/utils';
import { GlassSurface } from '../GlassSurface';
import type {
  GlassMaterialOverrides,
  GlassPresetName,
  GlassShape,
} from '../glassMaterial';

export type MezfitDialogProps = ComponentProps<typeof KonstaDialog> & {
  glassPreset?: GlassPresetName;
  glass?: GlassMaterialOverrides;
  glassShape?: GlassShape;
};

const canonicalDark = (classNames: string) => classNames;

export function MezfitDialog(props: MezfitDialogProps) {
  const {
    component = 'div',
    className,
    colors: colorsProp,

    opened,
    backdrop = true,
    onBackdropClick,

    titleFontSizeIos = 'text-[17px]',
    titleFontSizeMaterial = 'text-[24px]',
    title,
    content,
    buttons,

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

  const theme = useTheme();
  const colors = DialogColors(colorsProp, canonicalDark);
  const c = DialogClasses(
    {
      ...props,
      titleFontSizeIos,
      titleFontSizeMaterial,
    },
    colors,
  );

  const baseClasses = cls(
    c.base.common,
    c.base[theme],
    c.base[state],
    className,
  );
  const contentWrapClasses = cls(c.contentWrap.common, c.contentWrap[theme]);
  const titleClasses = cls(c.title.common, c.title[theme]);
  const contentClasses = cls(c.content.common, c.content[theme]);
  const buttonsClasses = cls(c.buttons.common, c.buttons[theme]);
  const backdropClasses = cls(c.backdrop.common, c.backdrop[state]);

  const setRef = (element: HTMLElement | null) => {
    elRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  const dialogContent = (
    <>
      <div className={contentWrapClasses}>
        {title && <div className={titleClasses}>{title}</div>}
        {(content || children) && (
          <div className={contentClasses}>
            {content}
            {children}
          </div>
        )}
      </div>

      {buttons && <div className={buttonsClasses}>{buttons}</div>}
    </>
  );

  return (
    <>
      {backdrop && (
        <div className={backdropClasses} onClick={onBackdropClick} />
      )}
      {theme === 'ios' ? (
        <GlassSurface
          component={Component}
          ref={setRef}
          className={cls('k-glass touch-none', baseClasses)}
          preset={glassPreset}
          glass={glass}
          shape={glassShape}
          wrapContent={false}
          active={Boolean(opened)}
          {...attrs}
        >
          {dialogContent}
        </GlassSurface>
      ) : (
        <KonstaGlass
          component={Component}
          highlight={false}
          ref={setRef}
          className={baseClasses}
          {...attrs}
        >
          {dialogContent}
        </KonstaGlass>
      )}
    </>
  );
}

MezfitDialog.displayName = 'MezfitDialog';
