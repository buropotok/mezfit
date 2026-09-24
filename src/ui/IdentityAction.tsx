import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Glass as KonstaGlass } from 'konsta/react';
import { Avatar } from './primitives';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

export type IdentityActionProps = {
  avatar: IdentityActionAvatar;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
};

const IdentityGlassButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ 'aria-disabled': ariaDisabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      {...props}
      aria-disabled={ariaDisabled}
      disabled={ariaDisabled === true || ariaDisabled === 'true'}
    />
  ),
);

IdentityGlassButton.displayName = 'IdentityGlassButton';

export function IdentityAction({
  avatar,
  title,
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
}: IdentityActionProps) {
  return (
    <KonstaGlass
      component={IdentityGlassButton}
      highlight={!disabled}
      className={`ui-identity-action${disabled ? ' ui-identity-action--disabled' : ''}`}
      aria-label={ariaLabel ?? title}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      <span aria-hidden="true">
        <Avatar
          className="ui-identity-action__avatar"
          name={avatar.name}
          src={avatar.src}
        />
      </span>
      <span className="ui-identity-action__title">{title}</span>
    </KonstaGlass>
  );
}
