import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import './badge.css';

export type BadgeColor = 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'cyan' | 'gray';

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  color?: BadgeColor;
  textVariant?: 'body' | 'caption';
  /** Outline styling keeps selected set-type chips neutral until activated. */
  variant?: 'filled' | 'outline';
  selected?: boolean;
  children: ReactNode;
};

export function Badge({ color = 'gray', textVariant = 'body', variant = 'filled', selected = false, className = '', children, ...props }: BadgeProps) {
  return (
    <span {...props} className={`ui-badge ui-text--${textVariant} ui-badge--${color}${variant === 'outline' ? ' ui-badge--outline' : ''}${selected ? ' ui-badge--selected' : ''} ${className}`.trim()}>
      {children}
    </span>
  );
}

/** Clickable badge choice with native button semantics and the canonical Badge material. */
export type BadgeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'children'> & {
  color?: BadgeColor;
  selected?: boolean;
  children: ReactNode;
};
export function BadgeButton({ color = 'gray', selected = false, className = '', children,
  type = 'button', ...props }: BadgeButtonProps) {
  return <button {...props} type={type} aria-pressed={selected}
    className={`ui-badge-button ${className}`.trim()}>
    <Badge color={color} variant="outline" selected={selected}>{children}</Badge>
  </button>;
}
