import type { ButtonHTMLAttributes } from 'react';
import { Glass } from 'konsta/react';
import { Avatar } from './primitives';
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
  ...props
}: IdentityActionProps) {
  return (
    <Glass
      component="button"
      type={type}
      disabled={disabled}
      aria-label={ariaLabel ?? title}
      className={`ui-identity-action ${className}`.trim()}
      {...props}
    >
      <span aria-hidden="true">
        <Avatar className="ui-identity-action__avatar" name={avatar.name} src={avatar.src} />
      </span>
      <span className="ui-identity-action__title">{title}</span>
    </Glass>
  );
}
