import { cloneElement, useEffect, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';
import { IdentityAction } from './IdentityAction';
import { NavbarMetaball, type NavbarMetaballIdentity } from './NavbarMetaball';
import type { GlassPresetName } from './glassMaterial';
import { MEZFIT_NAVBAR_GLASS_PRESET } from './mezfitNavbarConfig';
import './mezfit-navbar.css';

export type MezfitNavbarIdentity = NavbarMetaballIdentity;

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
  glassBlur?: number;
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
  glassBlur,
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
          <NavbarMetaball
            level={level}
            identity={identity}
            onBack={onBack}
            onIdentityClick={onIdentityClick}
            glassPreset={glassPreset}
            glassOptics={glassOptics}
            glassBlur={glassBlur}
          />

          <div className="ui-mezfit-navbar__side ui-mezfit-navbar__side--right" style={rightControlHidden ? { visibility: 'hidden' } : undefined}>
            <IdentityAction
              variant="double"
              surfaceRef={rightControlRef}
              glassPreset={glassPreset}
              glassOptics={glassOptics}
              glassBlur={glassBlur}
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
