import type { ButtonHTMLAttributes } from 'react';
import { Button as KonstaButton } from 'konsta/react';
import { Avatar } from './primitives';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

export type IdentityActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'style'> & {
  avatar: IdentityActionAvatar;
  title: string;
};

const identityButtonColors = {
  tonalBgIos: 'bg-black/10 dark:bg-white/10 active:bg-black/15 dark:active:bg-white/15',
  tonalTextIos: 'text-black dark:text-white',
};

export function IdentityAction({
  avatar,
  title,
  type = 'button',
  disabled,
  'aria-label': ariaLabel,
  ...props
}: IdentityActionProps) {
  return (
    <KonstaButton
      inline
      rounded
      raised
      tonal
      large
      colors={identityButtonColors}
      type={type}
      disabled={disabled}
      aria-label={ariaLabel ?? title}
      {...props}
    >
      <span className="ui-identity-action__content">
        <span aria-hidden="true">
          <Avatar name={avatar.name} src={avatar.src} />
        </span>
        <span className="ui-identity-action__title">{title}</span>
      </span>
    </KonstaButton>
  );
}
