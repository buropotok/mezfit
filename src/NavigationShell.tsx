import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, Role } from './api';

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
  icon: string;
  section?: 'secondary';
}

const coachItems: NavigationItem[] = [
  { id: 'clients', label: 'Клиенты', icon: '👥' },
  { id: 'programs', label: 'Программы', icon: '▤' },
  { id: 'exercises', label: 'Упражнения', icon: '◆' },
  { id: 'calendar', label: 'Календарь', icon: '□' },
  { id: 'settings', label: 'Настройки', icon: '⚙', section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: 'ⓘ', section: 'secondary' },
];

const clientItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: '✓' },
  { id: 'programs', label: 'Программа', icon: '▤' },
  { id: 'exercises', label: 'Упражнения', icon: '◆' },
  { id: 'history', label: 'История', icon: '↶' },
  { id: 'progress', label: 'Прогресс', icon: '↗' },
  { id: 'settings', label: 'Настройки', icon: '⚙', section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: 'ⓘ', section: 'secondary' },
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const items = itemsForRole(activeRole);

  const closeDrawer = () => {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  useEffect(() => {
    if (!drawerOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const drawer = drawerRef.current;
    const focusable = () => Array.from(
      drawer?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );
    window.requestAnimationFrame(() => focusable()[0]?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
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
  }, [drawerOpen]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [activeRole]);

  const chooseDestination = (next: AppDestination) => {
    onDestinationChange(next);
    closeDrawer();
  };

  const switchRole = (role: Role) => {
    onRoleSwitch(role);
    closeDrawer();
  };

  let previousSection: NavigationItem['section'];

  return (
    <main className="app-shell navigation-shell">
      <header className="navigation-appbar">
        {context ? (
          <button className="navigation-icon-button" type="button" onClick={context.onBack} aria-label="Назад">←</button>
        ) : (
          <button
            ref={menuButtonRef}
            className="navigation-icon-button"
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Открыть меню"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
          >☰</button>
        )}
        <h1>{context?.title ?? destinationTitle(activeRole, destination)}</h1>
        <span className="navigation-appbar-spacer" aria-hidden="true" />
      </header>

      <section className="navigation-content">{children}</section>

      {drawerOpen ? (
        <div className="drawer-layer">
          <button className="drawer-backdrop" type="button" aria-label="Закрыть меню" onClick={closeDrawer} />
          <aside ref={drawerRef} className="navigation-drawer" role="dialog" aria-modal="true" aria-label="Главное меню">
            <header className="drawer-account">
              <div className="drawer-avatar" aria-hidden="true">{me.user.firstName.slice(0, 1).toUpperCase()}</div>
              <div className="drawer-account-copy">
                <strong>{[me.user.firstName, me.user.lastName].filter(Boolean).join(' ')}</strong>
                <small>{roleLabel(activeRole)}</small>
              </div>
            </header>

            {me.roles.length > 1 ? (
              <div className="drawer-role-switch" aria-label="Режим приложения">
                {me.roles.map((role) => (
                  <button key={role} type="button" className={role === activeRole ? 'active' : ''} onClick={() => switchRole(role)}>
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
                      onClick={() => chooseDestination(item.id)}
                      aria-current={destination === item.id ? 'page' : undefined}
                    >
                      <span className="drawer-row-icon" aria-hidden="true">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  </div>
                );
              })}
            </nav>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
