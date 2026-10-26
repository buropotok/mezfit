import type { HTMLAttributes, ReactNode } from 'react';
import { Button as KonstaButton } from 'konsta/react';
import './badge.css';

export type BadgeColor = 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'cyan' | 'gray';

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & {
  color?: BadgeColor;
  textVariant?: 'body' | 'caption';
  selected?: boolean;
  children: ReactNode;
};

export function Badge({ color = 'gray', textVariant = 'body', selected = false, className = '', children, ...props }: BadgeProps) {
  return (
    <span {...props} className={`ui-badge ui-text--${textVariant} ui-badge--${color} ${selected ? 'ui-badge--selected' : ''} ${className}`.trim()}>
      {children}
    </span>
  );
}

/** A selectable Badge composed with the canonical Konsta button mechanics. */
export type BadgeChoiceProps = {
  children: ReactNode;
  color?: BadgeColor;
  textVariant?: 'body' | 'caption';
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
};

export function BadgeChoice({ children, color = 'gray', textVariant = 'caption',
  selected = false, disabled = false, onClick, className = '' }: BadgeChoiceProps) {
  return <KonstaButton clear small rounded disabled={disabled} onClick={onClick}
    aria-pressed={selected} className={className}>
    <Badge color={color} textVariant={textVariant} selected={selected}>{children}</Badge>
  </KonstaButton>;
}
