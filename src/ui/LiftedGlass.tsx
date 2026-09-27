import type { HTMLAttributes } from 'react';
import './LiftedGlass.css';

export type LiftedGlassProps = HTMLAttributes<HTMLDivElement>;

export function LiftedGlass({ className = '', ...props }: LiftedGlassProps) {
  return <div className={`ui-lifted-glass ${className}`.trim()} {...props} />;
}
