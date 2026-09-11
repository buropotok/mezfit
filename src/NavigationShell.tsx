import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { MeResponse, Role } from './api';
import { gymKeeperIcons, type GymKeeperIcon } from './gymKeeperIcons';
import { Calendar, Modal } from './ui';

export type AppDestination =
  | 'clients'
  | 'programs'
  | 'exercises'
  | 'calendar'
  | 'today'
  | 'history'
  | 'progress'
  | 'settings'
  | 'about';

export interface NavigationContext {
  title: string;
  onBack: () => void;
}

interface NavigationItem {
  id: AppDestination;
  label: string;
  icon: GymKeeperIcon;
  section?: 'secondary';
}

const coachItems: NavigationItem[] = [
  { id: 'clients', label: 'Клиенты', icon: 'clients' },
  { id: 'programs', label: 'Программы', icon: 'programs' },
  { id: 'exercises', label: 'Упражнения', icon: 'exercises' },
  { id: 'calendar', label: 'Календарь', icon: 'calendar' },
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: 'about', section: 'secondary' },
];

const clientItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: 'today' },
  { id: 'programs', label: 'Программа', icon: 'programs' },
  { id: 'exercises', label: 'Упражнения', icon: 'exercises' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'progress', label: 'Прогресс', icon: 'progress' },
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: 'about', section: 'secondary' },
];

function itemsForRole(role: Role): NavigationItem[] {
  return role === 'coach' ? coachItems : clientItems;
}

function roleLabel(role: Role): string {
  return role === 'coach' ? 'Тренер' : 'Клиент';
}

function destinationTitle(role: Role, destination: AppDestination): string {
  return itemsForRole(role).find((item) => item.id === destination)?.label ?? 'Mezfit';
}

function iconStyle(icon: GymKeeperIcon): CSSProperties {
  return { '--navigation-icon': gymKeeperIcons[icon] } as CSSProperties;
}

interface Props {
  me: MeResponse;
  activeRole: Role;
  destination: AppDestination;
  context: NavigationContext | null;
  onDestinationChange: (destination: AppDestination) => void;
  onRoleSwitch: (role: Role) => void;
  children: ReactNode;
}

export function NavigationShell({
  me,
  activeRole,
  destination,
  context,
  onDestinationChange,
  onRoleSwitch,
  children,
}: Props) {
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const items = itemsForRole(activeRole);

  const openMenu = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    setMenuMounted(true);
    window.requestAnimationFrame(() => setMenuOpen(true));
  };

  const closeMenu = () => {
    setMenuOpen(false);
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setMenuMounted(false);
      closeTimerRef.current = null;
      menuButtonRef.current?.focus();
    }, 200);
  };

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!menuMounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const menu = menuRef.current;
    const focusable = () => Array.from(
      menu?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );
    window.requestAnimationFrame(() => focusable()[0]?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuMounted]);

  useEffect(() => {
    setMenuOpen(false);
    setMenuMounted(false);
    setCalendarOpen(false);
  }, [activeRole]);

  const chooseDestination = (next: AppDestination) => {
    onDestinationChange(next);
    closeMenu();
  };

  const switchRole = (role: Role) => {
    onRoleSwitch(role);
    closeMenu();
  };

  let previousSection: NavigationItem['section'];

  return (
    <main className="app-shell navigation-shell">
      <header className="navigation-appbar">
        {context ? (
          <button className="navigation-icon-button" type="button" onClick={context.onBack} aria-label="Назад">
            <span className="navigation-apk-icon" style={iconStyle('back')} aria-hidden="true" />
          </button>
        ) : (
          <div className="navigation-menu-anchor">
            <button
              ref={menuButtonRef}
              className="navigation-icon-button"
              type="button"
              onClick={openMenu}
              aria-label="Открыть меню"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="navigation-apk-icon" style={iconStyle('menu')} aria-hidden="true" />
            </button>

            {menuMounted ? (
              <div className={`drawer-layer ${menuOpen ? 'open' : 'closing'}`}>
                <button className="drawer-backdrop" type="button" aria-label="Закрыть меню" onClick={closeMenu} />
                {/* Source-level port: Ajaxy/telegram-tt MainMenuDropdown -> DropdownMenu -> Menu/MenuItem. */}
                <aside ref={menuRef} className="navigation-drawer" role="menu" aria-label="Главное меню">
                  <div className="drawer-account" role="presentation">
                    <div className="drawer-avatar" aria-hidden="true">{me.user.firstName.slice(0, 1).toUpperCase()}</div>
                    <div className="drawer-account-copy">
                      <strong>{[me.user.firstName, me.user.lastName].filter(Boolean).join(' ')}</strong>
                      <small>{roleLabel(activeRole)}</small>
                    </div>
                  </div>

                  {me.roles.length > 1 ? (
                    <div className="drawer-role-switch" aria-label="Режим приложения" role="group">
                      {me.roles.map((role) => (
                        <button key={role} type="button" role="menuitemradio" aria-checked={role === activeRole} className={role === activeRole ? 'active' : ''} onClick={() => switchRole(role)}>
                          {roleLabel(role)}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <nav className="drawer-nav" aria-label="Разделы приложения">
                    {items.map((item) => {
                      const divider = item.section === 'secondary' && previousSection !== 'secondary';
                      previousSection = item.section;
                      return (
                        <div key={item.id} className={divider ? 'drawer-nav-group drawer-nav-group-secondary' : 'drawer-nav-group'}>
                          <button
                            className={`drawer-row ${destination === item.id ? 'active' : ''}`}
                            type="button"
                            role="menuitem"
                            onClick={() => chooseDestination(item.id)}
                            aria-current={destination === item.id ? 'page' : undefined}
                          >
                            <span className="drawer-row-icon navigation-apk-icon" style={iconStyle(item.icon)} aria-hidden="true" />
                            <span>{item.label}</span>
                          </button>
                        </div>
                      );
                    })}
                  </nav>
                </aside>
              </div>
            ) : null}
          </div>
        )}
        <h1>{context?.title ?? destinationTitle(activeRole, destination)}</h1>
        <button className="navigation-icon-button" type="button" onClick={() => setCalendarOpen(true)} aria-label="Открыть календарь">
          <span className="navigation-apk-icon" style={iconStyle('calendar')} aria-hidden="true" />
        </button>
      </header>

      <section className="navigation-content">{children}</section>

      <Modal isOpen={calendarOpen} title="Календарь" className="ui-calendar-modal" onClose={() => setCalendarOpen(false)}>
        <Calendar value={selectedDate} onChange={(date) => { if (date) setSelectedDate(date); }} />
      </Modal>
    </main>
  );
}
