import type { ButtonHTMLAttributes } from 'react';
import { Avatar } from './primitives';
import { startPressScale } from './PressScale';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

export type IdentityActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  avatar: IdentityActionAvatar;
  title: string;
};

export function IdentityAction({
  avatar,
  title,
  className = '',
  type = 'button',
  disabled,
  'aria-label': ariaLabel,
  onPointerDown,
  ...props
}: IdentityActionProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-label={ariaLabel ?? title}
      className={`ui-identity-action ${className}`.trim()}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget);
      }}
      {...props}
    >
      <span aria-hidden="true">
        <Avatar className="ui-identity-action__avatar" name={avatar.name} src={avatar.src} />
      </span>
      <span className="ui-identity-action__title">{title}</span>
    </button>
  );
}
