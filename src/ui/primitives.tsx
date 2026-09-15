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

export function Button({ variant = 'primary', className = '', type = 'button', onPointerDown, onKeyDown, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props} />;
}

export function IconButton({ label, className = '', type = 'button', children, onPointerDown, onKeyDown, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type={type} aria-label={label} className={`ui-icon-button ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props}>{children}</button>;
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
