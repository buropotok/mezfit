import type { HTMLAttributes, ReactNode } from 'react';
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
