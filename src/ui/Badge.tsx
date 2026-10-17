import type { HTMLAttributes, ReactNode } from 'react';
import './badge.css';

export type BadgeColor = 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'cyan' | 'gray';

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  color?: BadgeColor;
  textVariant?: 'body' | 'caption';
  children: ReactNode;
};

export function Badge({ color = 'gray', textVariant = 'body', className = '', children, ...props }: BadgeProps) {
  return (
    <span {...props} className={`ui-badge ui-text--${textVariant} ui-badge--${color} ${className}`.trim()}>
      {children}
    </span>
  );
}
