import { Fab as KonstaFab } from 'konsta/react';
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

const enabledFabColors = {
  bgIos: 'bg-ios-light-glass dark:bg-ios-dark-glass',
  activeBgIos: 'active:bg-black/10 dark:active:bg-white/10',
  textIos: 'text-black dark:text-white',
};

const disabledFabColors = {
  bgIos: 'bg-black/5 dark:bg-white/5',
  activeBgIos: '',
  textIos: 'text-black/30 dark:text-white/30',
};

export function IdentityAction({
  avatar,
  title,
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
}: IdentityActionProps) {
  return (
    <KonstaFab
      component="button"
      type="button"
      colors={disabled ? disabledFabColors : enabledFabColors}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      text={
        <span aria-hidden="true">
          <Avatar name={avatar.name} src={avatar.src} />
        </span>
      }
      disabled={disabled}
    >
      <span className="ui-identity-action__title">{title}</span>
    </KonstaFab>
  );
}
