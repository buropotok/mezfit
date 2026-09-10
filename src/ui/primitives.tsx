import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ImgHTMLAttributes, ReactNode } from 'react';
import './ui.css';

type TextVariant = 'body' | 'caption' | 'title';
type TextTone = 'default' | 'muted';

export function Text({ variant = 'body', tone = 'default', className = '', children, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: TextVariant; tone?: TextTone }) {
  return <span className={`ui-text ui-text--${variant} ui-text--${tone} ${className}`.trim()} {...props}>{children}</span>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} {...props} />;
}

export function IconButton({ label, className = '', type = 'button', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type={type} aria-label={label} className={`ui-icon-button ${className}`.trim()} {...props}>{children}</button>;
}

type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt'> & { name: string; src?: string };

export function Avatar({ name, src, className = '', ...props }: AvatarProps) {
  if (src) return <img className={`ui-avatar ${className}`.trim()} src={src} alt="" {...props} />;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'M';
  return <span className={`ui-avatar ui-avatar--fallback ${className}`.trim()} aria-label={name} role="img">{initials}</span>;
}

export function Divider({ className = '', ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={`ui-divider ${className}`.trim()} {...props} />;
}

type SurfaceProps = HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article'; elevated?: boolean; style?: CSSProperties };

export function Surface({ as: Component = 'div', elevated = false, className = '', ...props }: SurfaceProps) {
  return <Component className={`ui-surface${elevated ? ' ui-surface--elevated' : ''} ${className}`.trim()} {...props} />;
}
