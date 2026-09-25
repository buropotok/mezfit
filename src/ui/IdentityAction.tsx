import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Glass as KonstaGlass } from 'konsta/react';
import { Icon, type UiIconName } from './Icon';
import { Avatar } from './primitives';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

type IdentityActionVisual =
  | { avatar: IdentityActionAvatar; icon?: never }
  | { avatar?: never; icon: UiIconName };

export type IdentityActionProps = IdentityActionVisual & {
  title: string;
  variant?: 'default' | 'avatar-only';
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
  icon,
  title,
  variant = 'default',
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
}: IdentityActionProps) {
  return (
    <KonstaGlass
      component={IdentityGlassButton}
      highlight={!disabled}
      className={`ui-identity-action${variant === 'avatar-only' ? ' ui-identity-action--avatar-only' : ''}${disabled ? ' ui-identity-action--disabled' : ''}`}
      aria-label={ariaLabel ?? title}
      aria-disabled={disabled || undefined}
      onClick={onClick}
    >
      <span className="ui-identity-action__visual" aria-hidden="true">
        {icon ? (
          <Icon className="ui-identity-action__icon" name={icon} variant="filled" />
        ) : (
          <Avatar
            className="ui-identity-action__avatar"
            name={avatar.name}
            src={avatar.src}
          />
        )}
      </span>
      {variant === 'default' && <span className="ui-identity-action__title">{title}</span>}
    </KonstaGlass>
  );
}
