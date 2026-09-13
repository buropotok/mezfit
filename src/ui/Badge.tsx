import type { HTMLAttributes, ReactNode } from 'react';
import './badge.css';

export type BadgeColor = 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'cyan' | 'gray';

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  color?: BadgeColor;
  children: ReactNode;
};

export function Badge({ color = 'gray', className = '', children, ...props }: BadgeProps) {
  return (
    <span {...props} className={`ui-badge ui-badge--${color} ${className}`.trim()}>
      {children}
    </span>
  );
}
