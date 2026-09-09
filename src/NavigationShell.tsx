import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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

const iconUrls = {
  clients: new URL('./assets/gk-icons/ic_change_person.png', import.meta.url).href,
  programs: new URL('./assets/gk-icons/ic_workout.png', import.meta.url).href,
  exercises: new URL('./assets/gk-icons/ic_exercise.png', import.meta.url).href,
  calendar: new URL('./assets/gk-icons/ic_calendar.png', import.meta.url).href,
  settings: new URL('./assets/gk-icons/ic_settings.png', import.meta.url).href,
  about: new URL('./assets/gk-icons/ic_info.png', import.meta.url).href,
  today: new URL('./assets/gk-icons/ic_today.png', import.meta.url).href,
  history: new URL('./assets/gk-icons/ic_history.png', import.meta.url).href,
  progress: new URL('./assets/gk-icons/ic_stat.png', import.meta.url).href,
  back: new URL('./assets/gk-icons/ic_back.png', import.meta.url).href,
  menu: new URL('./assets/gk-icons/menu.svg', import.meta.url).href,
} as const;

const coachItems: NavigationItem[] = [
  { id: 'clients', label: 'Клиенты', icon: iconUrls.clients },
  { id: 'programs', label: 'Программы', icon: iconUrls.programs },
  { id: 'exercises', label: 'Упражнения', icon: iconUrls.exercises },
  { id: 'calendar', label: 'Календарь', icon: iconUrls.calendar },
  { id: 'settings', label: 'Настройки', icon: iconUrls.settings, section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: iconUrls.about, section: 'secondary' },
];

const clientItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: iconUrls.today },
  { id: 'programs', label: 'Программа', icon: iconUrls.programs },
  { id: 'exercises', label: 'Упражнения', icon: iconUrls.exercises },
  { id: 'history', label: 'История', icon: iconUrls.history },
  { id: 'progress', label: 'Прогресс', icon: iconUrls.progress },
  { id: 'settings', label: 'Настройки', icon: iconUrls.settings, section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: iconUrls.about, section: 'secondary' },
];

const DRAWER_CLOSE_MS = 180;

type IconStyle = CSSProperties & { '--gk-icon-url': string };

function ReferenceIcon({ src, className = '' }: { src: string; className?: string }) {
  const style: IconStyle = { '--gk-icon-url': `url("${src}")` };
  return <span className={`gk-reference-icon ${className}`.trim()} style={style} aria-hidden="true" />;
}

function itemsForRole(role: Role): NavigationItem[] {
  return role === 'coach' ? coachItems : clientItems;
}

function roleLabel(role: Role): string {
  return role === 'coach' ? 'Тренер' : 'Клиент';
}

function destinationTitle(role: Role, destination: AppDestination): string {
  return itemsForRole(role).find((item) => item.id === destination)?.label ?? 'Mezfit';
}

function reducedMotionPreferred(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
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
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(true);
  const items = itemsForRole(activeRole);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const finishClose = useCallback(() => {
    clearCloseTimer();
    setDrawerMounted(false);
    if (restoreFocusRef.current) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, [clearCloseTimer]);

  const closeDrawer = useCallback((restoreFocus = true) => {
    if (!drawerMounted) return;
    restoreFocusRef.current = restoreFocus;
    clearCloseTimer();
    setDrawerOpen(false);

    if (reducedMotionPreferred()) {
      finishClose();
      return;
    }

    closeTimerRef.current = window.setTimeout(finishClose, DRAWER_CLOSE_MS + 24);
  }, [clearCloseTimer, drawerMounted, finishClose]);

  const openDrawer = useCallback(() => {
    clearCloseTimer();
    restoreFocusRef.current = true;
    setDrawerMounted(true);
    setDrawerOpen(false);

    if (openFrameRef.current !== null) window.cancelAnimationFrame(openFrameRef.current);
    openFrameRef.current = window.requestAnimationFrame(() => {
      openFrameRef.current = null;
      setDrawerOpen(true);
    });
  }, [clearCloseTimer]);

  useEffect(() => () => {
    clearCloseTimer();
    if (openFrameRef.current !== null) window.cancelAnimationFrame(openFrameRef.current);
  }, [clearCloseTimer]);

  useEffect(() => {
    if (!drawerMounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () => Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [],
    );

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
  }, [closeDrawer, drawerMounted]);

  useEffect(() => {
    if (!drawerMounted || !drawerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const first = drawerRef.current?.querySelector<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      first?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawerMounted, drawerOpen]);

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
          <button className="navigation-icon-button" type="button" onClick={context.onBack} aria-label="Назад">
            <ReferenceIcon src={iconUrls.back} className="navigation-action-icon" />
          </button>
        ) : (
          <button
            ref={menuButtonRef}
            className="navigation-icon-button"
            type="button"
            onClick={openDrawer}
            aria-label="Открыть меню"
            aria-haspopup="dialog"
            aria-expanded={drawerMounted && drawerOpen}
          >
            <ReferenceIcon src={iconUrls.menu} className="navigation-action-icon" />
          </button>
        )}
        <h1>{context?.title ?? destinationTitle(activeRole, destination)}</h1>
        <span className="navigation-appbar-spacer" aria-hidden="true" />
      </header>

      <section className="navigation-content">{children}</section>

      {drawerMounted ? (
        <div className={`drawer-layer ${drawerOpen ? 'is-open' : 'is-closing'}`}>
          <button className="drawer-backdrop" type="button" aria-label="Закрыть меню" onClick={() => closeDrawer()} />
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
                      <ReferenceIcon src={item.icon} className="drawer-row-icon" />
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
