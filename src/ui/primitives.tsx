import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import { isPressScaleActivationKey, startPressScale } from './PressScale';
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

export function Button({ variant = 'primary', color, size = 'default', selected = false, shadow = false, className = '', type = 'button', onPointerDown, onKeyDown, disabled, ...props }: ButtonProps) {
  const colorClass = color ? ` ui-button--color-${color}` : '';
  return <button type={type} className={`ui-button ui-button--${variant} ui-button--${size}${colorClass}${selected ? ' ui-button--selected' : ''}${shadow ? ' ui-button--shadow' : ''} ${className}`.trim()} aria-pressed={props['aria-pressed'] ?? (selected || undefined)} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props} />;
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  color?: ButtonColor;
  selected?: boolean;
  shadow?: boolean;
};

export function IconButton({ label, color, selected = false, shadow = false, className = '', type = 'button', children, onPointerDown, onKeyDown, disabled, ...props }: IconButtonProps) {
  const colorClass = color ? ` ui-icon-button--color-${color}` : '';
  return <button type={type} aria-label={label} aria-pressed={props['aria-pressed'] ?? (selected || undefined)} className={`ui-icon-button${colorClass}${selected ? ' ui-icon-button--selected' : ''}${shadow ? ' ui-icon-button--shadow' : ''} ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props}>{children}</button>;
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

type SurfaceProps = HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article'; border?: boolean; elevated?: boolean; style?: CSSProperties };

export function Surface({ as: Component = 'div', border = true, elevated = false, className = '', ...props }: SurfaceProps) {
  return <Component className={`ui-surface${!border ? ' ui-surface--borderless' : ''}${elevated ? ' ui-surface--elevated' : ''} ${className}`.trim()} {...props} />;
}
