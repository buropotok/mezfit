import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import type { UiComponentTheme } from './componentTheme';
import type { UiIconPair } from './iconPair';
import { isPressScaleActivationKey, startPressScale } from './PressScale';
import { startSpringScale } from './SpringScale';
import './ui.css';
import './typography.css';

type TextVariant = 'body' | 'caption' | 'footnote' | 'headline' | 'title' | 'large-title';
type TextTone = 'default' | 'muted';

export function Text({ variant = 'body', tone = 'default', className = '', children, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: TextVariant; tone?: TextTone }) {
  return <span className={`ui-text ui-text--${variant} ui-text--${tone} ${className}`.trim()} {...props}>{children}</span>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({ variant = 'primary', className = '', type = 'button', onPointerDown, onKeyDown, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props} />;
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children?: ReactNode;
  theme?: UiComponentTheme;
  icon?: UiIconPair;
  selected?: boolean;
};

export function IconButton({ label, theme = 'default', icon, selected, className = '', type = 'button', children, onPointerDown, onKeyDown, disabled, ...props }: IconButtonProps) {
  const artworkRef = useRef<HTMLSpanElement>(null);
  const previousSelectedRef = useRef(selected);

  useEffect(() => {
    if (icon && previousSelectedRef.current !== selected && artworkRef.current) startSpringScale(artworkRef.current);
    previousSelectedRef.current = selected;
  }, [icon, selected]);

  if (selected !== undefined && !icon) {
    throw new Error('IconButton requires outline and filled icons when selected state is used.');
  }

  const content = icon ? (
    <span ref={artworkRef} className="ui-icon-button__artwork" aria-hidden="true">
      <span className="ui-icon-button__icon-outline">{icon.outline}</span>
      <span className="ui-icon-button__icon-filled">{icon.filled}</span>
    </span>
  ) : children;

  return <button type={type} aria-label={label} data-ui-theme={theme} data-selected={selected ? 'true' : undefined} className={`ui-icon-button ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props}>{content}</button>;
}

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

type SurfaceBaseProps = HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article'; elevated?: boolean; style?: CSSProperties };
type SurfaceDefaultProps = SurfaceBaseProps & { theme?: 'default'; border?: boolean };
type SurfaceGlassProps = SurfaceBaseProps & { theme: 'glass'; border?: never };
export type SurfaceProps = SurfaceDefaultProps | SurfaceGlassProps;

export function Surface({ as: Component = 'div', theme = 'default', border = true, elevated = false, className = '', ...props }: SurfaceProps) {
  const isBorderless = theme === 'default' && !border;
  return <Component data-ui-theme={theme} className={`ui-surface${isBorderless ? ' ui-surface--borderless' : ''}${elevated ? ' ui-surface--elevated' : ''} ${className}`.trim()} {...props} />;
}
