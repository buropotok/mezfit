import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { GlassSurface, Icon, Text } from '../ui';
import './start-workout-button.css';

export interface StartWorkoutButtonProps {
  disabled?: boolean;
  onClick?: () => void;
  label?: string;
  className?: string;
}

const StartButtonHost = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ 'aria-disabled': ariaDisabled, disabled, ...props }, ref) =>
    <button {...props} type="button" ref={ref}
      disabled={disabled || ariaDisabled === true || ariaDisabled === 'true'} aria-disabled={ariaDisabled} />,
);
StartButtonHost.displayName = 'StartButtonHost';

/** Shared source/scheduled Start action; GlassSurface owns the capsule geometry. */
export function StartWorkoutButton({ disabled = false, onClick, label = 'Начать тренировку', className = '' }: StartWorkoutButtonProps) {
  return <GlassSurface component={StartButtonHost} wrapContent={false} shape="capsule" preset="modalTuned"
    glass={{ tintR: 155, tintG: 222, tintB: 175, tintA: 0.14 }} aria-disabled={disabled}
    className={`start-workout-button ${className}`.trim()} onClick={() => { if (!disabled) onClick?.(); }}>
    <span className="start-workout-button__group">
      <span className="start-workout-button__icon"><Icon name="treadmill" /></span>
      <Text variant="body" className="start-workout-button__label">{label}</Text>
    </span>
  </GlassSurface>;
}
