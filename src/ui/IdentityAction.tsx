import type { ComponentProps } from 'react';
import { Fab as KonstaFab } from 'konsta/react';
import { Avatar } from './primitives';
import './identity-action.css';

export type IdentityActionAvatar = {
  name: string;
  src?: string;
};

export type IdentityActionProps = Omit<
  ComponentProps<typeof KonstaFab>,
  'children' | 'className' | 'colors' | 'component' | 'href' | 'icon' | 'text' | 'textPosition'
> & {
  avatar: IdentityActionAvatar;
  title: string;
};

const identityFabColors = {
  bgIos: 'bg-ios-light-glass dark:bg-ios-dark-glass',
  activeBgIos: 'active:bg-black/10 dark:active:bg-white/10',
  textIos: 'text-black dark:text-white',
};

export function IdentityAction({
  avatar,
  title,
  'aria-label': ariaLabel,
  ...props
}: IdentityActionProps) {
  return (
    <KonstaFab
      component="button"
      type="button"
      colors={identityFabColors}
      aria-label={ariaLabel ?? title}
      text={
        <span className="ui-identity-action__content">
          <span aria-hidden="true">
            <Avatar name={avatar.name} src={avatar.src} />
          </span>
          <span className="ui-identity-action__title">{title}</span>
        </span>
      }
      {...props}
    />
  );
}
