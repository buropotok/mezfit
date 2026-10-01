import { useEffect, useState } from 'react';
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
  glassPreset = MEZFIT_NAVBAR_GLASS_PRESET,
  menuDisabled = false,
  calendarDisabled = false,
}: MezfitNavbarProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setEntered(true);
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
        data-entered={entered ? 'true' : 'false'}
      >
        <div className="ui-mezfit-navbar__side ui-mezfit-navbar__side--left" aria-hidden={level === 1 || undefined}>
          <IdentityAction
            variant="single"
            icon="arrow-left"
            title="Назад"
            aria-label="Назад"
            glassPreset={glassPreset}
            disabled={level === 1}
            onClick={onBack}
          />
        </div>

        <div className="ui-mezfit-navbar__identity">
          {identity.icon ? (
            <IdentityAction
              variant="labeled"
              icon={identity.icon}
              title={identity.title}
              glassPreset={glassPreset}
              onClick={onIdentityClick}
            />
          ) : (
            <IdentityAction
              variant="labeled"
              avatar={identity.avatar}
              title={identity.title}
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
                icon: 'dots-vertical',
                label: 'Меню страницы',
                onClick: onMenu,
                disabled: menuDisabled,
              },
              {
                icon: 'calendar',
                label: 'Открыть календарь',
                onClick: onCalendar,
                disabled: calendarDisabled,
              },
            ]}
          />
        </div>
      </div>
    </Navbar>
  );
}
