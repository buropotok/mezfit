import { cloneElement, useEffect, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';
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
  rightControlRef?: Ref<HTMLElement>;
  rightControlHidden?: boolean;
  renderMenuControl?: (control: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>) => ReactNode;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
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
  rightControlRef,
  rightControlHidden = false,
  glassPreset = MEZFIT_NAVBAR_GLASS_PRESET,
  glassOptics = false,
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
    <header className="ui-mezfit-navbar">
      <div className="ui-mezfit-navbar__backdrop" aria-hidden="true" />
      <div className="ui-mezfit-navbar__content">
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
              glassOptics={glassOptics}
              onClick={level === 2 ? onBack : undefined}
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
                titleRole="headline"
                width="100%"
                glassPreset={glassPreset}
                glassOptics={glassOptics}
                onClick={onIdentityClick}
              />
            ) : (
              <IdentityAction
                variant="labeled"
                avatar={identity.avatar}
                title={identity.title}
                titleRole="headline"
                width="100%"
                glassPreset={glassPreset}
                glassOptics={glassOptics}
                onClick={onIdentityClick}
              />
            )}
          </div>

          <div className="ui-mezfit-navbar__side ui-mezfit-navbar__side--right" style={rightControlHidden ? { visibility: 'hidden' } : undefined}>
            <IdentityAction
              variant="double"
              surfaceRef={rightControlRef}
              glassPreset={glassPreset}
              glassOptics={glassOptics}
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
                  renderControl: (control) => {
                    const immediateControl = cloneElement(control, {
                      onClick: () => onMenu(),
                    });
                    return renderMenuControl ? renderMenuControl(immediateControl) : immediateControl;
                  },
                },
              ]}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
