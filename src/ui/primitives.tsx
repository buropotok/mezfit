import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import { resolveUiIconPair } from './Icon';
import type { UiIconSource } from './iconPair';
import { isPressScaleActivationKey, startPressScale } from './PressScale';
import { startSpringScale } from './SpringScale';
import { LiquidGlassIconButtonFilter, LiquidGlassOpticalFilter, useLiquidGlassFilterId, type LiquidGlassGeometry } from './liquidGlass';
import './ui.css';
import './typography.css';

type TextVariant = 'body' | 'caption' | 'footnote' | 'headline' | 'title' | 'large-title';
type TextTone = 'default' | 'muted';

export function Text({ variant = 'body', tone = 'default', className = '', children, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: TextVariant; tone?: TextTone }) {
  return <span className={`ui-text ui-text--${variant} ui-text--${tone} ${className}`.trim()} {...props}>{children}</span>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonColor = 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'cyan' | 'gray';
type ButtonSize = 'default' | 'compact';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  color?: ButtonColor;
  size?: ButtonSize;
  selected?: boolean;
  shadow?: boolean;
};

export function Button({ variant = 'primary', color, size = 'default', selected: selectedProp, shadow = false, className = '', type = 'button', onPointerDown, onKeyDown, disabled, ...props }: ButtonProps) {
  const selected = selectedProp === true;
  const colorClass = color ? ` ui-button--color-${color}` : '';
  return <button type={type} className={`ui-button ui-button--${variant} ui-button--${size}${colorClass}${selected ? ' ui-button--selected' : ''}${shadow ? ' ui-button--shadow' : ''} ${className}`.trim()} aria-pressed={props['aria-pressed'] ?? (selectedProp === undefined ? undefined : selected)} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props} />;
}

type IconButtonBaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
  label: string;
  children?: ReactNode;
  icon?: UiIconSource;
};
type IconButtonDefaultProps = IconButtonBaseProps & {
  theme?: 'default';
  color?: ButtonColor;
  selected?: boolean;
  shadow?: boolean;
};
type IconButtonGlassTheme = 'glass' | 'liquidGlass';
type IconButtonGlassIdleProps = IconButtonBaseProps & {
  theme: IconButtonGlassTheme;
  color?: never;
  selected?: undefined;
  shadow?: never;
};
type IconButtonGlassSelectableProps = IconButtonBaseProps & {
  theme: IconButtonGlassTheme;
  color?: never;
  selected: boolean;
  shadow?: never;
  icon: UiIconSource;
};
export type IconButtonProps = IconButtonDefaultProps | IconButtonGlassIdleProps | IconButtonGlassSelectableProps;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, theme = 'default', icon, color, selected: selectedProp, shadow = false, className = '', type = 'button', children, onPointerDown, onKeyDown, disabled, style, ...props }, ref) {
  const selected = selectedProp === true;
  const iconPair = icon ? resolveUiIconPair(icon) : undefined;
  const colorClass = theme === 'default' && color ? ` ui-icon-button--color-${color}` : '';
  const selectedClass = theme === 'default' && selected ? ' ui-icon-button--selected' : '';
  const shadowClass = theme === 'default' && shadow ? ' ui-icon-button--shadow' : '';
  const artworkRef = useRef<HTMLSpanElement>(null);
  const previousSelectedRef = useRef(selected);
  const liquidGlassFilterId = useLiquidGlassFilterId('icon-button');
  const liquidStyle = theme === 'liquidGlass'
    ? { ...style, '--ui-liquid-glass-filter': `url(#${liquidGlassFilterId})` } as CSSProperties
    : style;

  useEffect(() => {
    if (iconPair && previousSelectedRef.current !== selected && artworkRef.current) startSpringScale(artworkRef.current);
    previousSelectedRef.current = selected;
  }, [icon, selected]);

  const content = iconPair ? (
    <span ref={artworkRef} className="ui-icon-button__artwork" aria-hidden="true">
      <span className="ui-icon-button__icon-outline">{iconPair.outline}</span>
      <span className="ui-icon-button__icon-filled">{iconPair.filled}</span>
    </span>
  ) : children;

  return <button ref={ref} type={type} aria-label={label} aria-pressed={props['aria-pressed'] ?? (selectedProp === undefined ? undefined : selected)} data-ui-theme={theme} data-selected={selected ? 'true' : undefined} className={`ui-icon-button${colorClass}${selectedClass}${shadowClass} ${className}`.trim()} disabled={disabled} style={liquidStyle} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props}>{theme === 'liquidGlass' ? <LiquidGlassIconButtonFilter id={liquidGlassFilterId} /> : null}{content}</button>;
});
type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'onError'> & { name: string; src?: string };

export function Avatar({ name, src, className = '', ...props }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [src]);

  if (src && !imageFailed) {
    return <img className={`ui-avatar ${className}`.trim()} src={src} alt="" onError={() => setImageFailed(true)} {...props} />;
  }
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'M';
  return <span className={`ui-avatar ui-avatar--fallback ${className}`.trim()} aria-label={name} role="img">{initials}</span>;
}

export function Divider({ className = '', ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={`ui-divider ${className}`.trim()} {...props} />;
}

type SurfaceBaseProps = HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article'; style?: CSSProperties };
type SurfaceDefaultProps = SurfaceBaseProps & { theme?: 'default'; border?: boolean; elevated?: boolean };
type SurfaceGlassProps = SurfaceBaseProps & { theme: 'glass' | 'liquidGlass'; border?: never; elevated?: never };
export type SurfaceProps = SurfaceDefaultProps | SurfaceGlassProps;

export function Surface({ as: Component = 'div', theme = 'default', border = true, elevated = false, className = '', style, children, ...props }: SurfaceProps) {
  const isBorderless = theme === 'default' && !border;
  const isElevated = theme === 'default' && elevated;
  const surfaceRef = useRef<HTMLElement>(null);
  const liquidGlassFilterId = useLiquidGlassFilterId('surface');
  const [liquidGeometry, setLiquidGeometry] = useState<LiquidGlassGeometry>({ width: 1, height: 1, radiusX: 1, radiusY: 1 });

  useLayoutEffect(() => {
    if (theme !== 'liquidGlass') return undefined;
    const element = surfaceRef.current;
    if (!element) return undefined;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || Math.min(rect.width, rect.height) / 2;
      setLiquidGeometry({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        radiusX: radius,
        radiusY: radius,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [theme]);

  const liquidStyle = theme === 'liquidGlass'
    ? { ...style, '--ui-liquid-glass-filter': `url(#${liquidGlassFilterId})` } as CSSProperties
    : style;

  return (
    <Component ref={(node: HTMLElement | null) => { surfaceRef.current = node; }} data-ui-theme={theme} className={`ui-surface${isBorderless ? ' ui-surface--borderless' : ''}${isElevated ? ' ui-surface--elevated' : ''} ${className}`.trim()} style={liquidStyle} {...props}>
      {theme === 'liquidGlass' ? <LiquidGlassOpticalFilter id={liquidGlassFilterId} geometry={liquidGeometry} /> : null}
      {children}
    </Component>
  );
}
