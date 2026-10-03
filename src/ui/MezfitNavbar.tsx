import { useEffect, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Navbar } from 'konsta/react';
import { IdentityAction, type IdentityActionAvatar } from './IdentityAction';
import type { UiIconName } from './Icon';
import type { GlassPresetName } from './glassMaterial';
import { MEZFIT_NAVBAR_GLASS_PRESET } from './mezfitNavbarConfig';
import './mezfit-navbar.css';

export type MezfitNavbarIdentity =
  | { title: string; icon: UiIconName; avatar?: never }
  | { title: string; avatar: IdentityActionAvatar; icon?: never };

export type MezfitNavbarProps = {
  level: 1 | 2;
  identity: MezfitNavbarIdentity;
  onBack: () => void;
  onMenu: () => void;
  onCalendar: () => void;
  onIdentityClick?: () => void;
  renderMenuControl?: (control: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>) => ReactNode;
  glassPreset?: GlassPresetName;
  menuDisabled?: boolean;
  calendarDisabled?: boolean;
};

export function MezfitNavbar({
  level,
  identity,
  onBack,
  onMenu,
  onCalendar,
  onIdentityClick,
  renderMenuControl,
  glassPreset = MEZFIT_NAVBAR_GLASS_PRESET,
  menuDisabled = false,
  calendarDisabled = false,
}: MezfitNavbarProps) {
  const [entryPhase, setEntryPhase] = useState<'collapsed' | 'spread' | 'settled'>('collapsed');

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setEntryPhase('settled');
      return undefined;
    }

    const hasAnimationFrame = typeof window.requestAnimationFrame === 'function';
    const frame = hasAnimationFrame
      ? window.requestAnimationFrame(() => setEntryPhase('spread'))
      : window.setTimeout(() => setEntryPhase('spread'), 0);
    const timer = window.setTimeout(() => setEntryPhase('settled'), 340);
    return () => {
      if (hasAnimationFrame) window.cancelAnimationFrame(frame);
      else window.clearTimeout(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Navbar
      component="header"
      transparent
      outline={false}
      className="ui-mezfit-navbar"
    >
      <div
        className="ui-mezfit-navbar__layout"
        data-level={level}
        data-entry-phase={entryPhase}
      >
        <div className="ui-mezfit-navbar__side ui-mezfit-navbar__side--left" aria-hidden={level === 1 || undefined}>
          <IdentityAction
            variant="single"
            icon="chevron-left"
            iconVariant="outline"
            iconSize={32}
            title="Назад"
            aria-label="Назад"
            glassPreset={glassPreset}
            disabled={level === 1 && entryPhase === 'settled'}
            onClick={onBack}
          />
        </div>

        <div className="ui-mezfit-navbar__identity">
          {identity.icon ? (
            <IdentityAction
              variant="labeled"
              icon={identity.icon}
              iconVariant="outline"
              iconSize={32}
              title={identity.title}
              width="100%"
              glassPreset={glassPreset}
              onClick={onIdentityClick}
            />
          ) : (
            <IdentityAction
              variant="labeled"
              avatar={identity.avatar}
              title={identity.title}
              width="100%"
              glassPreset={glassPreset}
              onClick={onIdentityClick}
            />
          )}
        </div>

        <div className="ui-mezfit-navbar__side ui-mezfit-navbar__side--right">
          <IdentityAction
            variant="double"
            glassPreset={glassPreset}
            actions={[
              {
                icon: 'calendar',
                iconVariant: 'outline',
                iconSize: 32,
                label: 'Открыть календарь',
                onClick: onCalendar,
                disabled: calendarDisabled,
              },
              {
                icon: 'menu-2',
                iconVariant: 'outline',
                iconSize: 32,
                label: 'Меню страницы',
                onClick: onMenu,
                disabled: menuDisabled,
                renderControl: renderMenuControl,
              },
            ]}
          />
        </div>
      </div>
    </Navbar>
  );
}
