import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { MeResponse, Role } from './api';
import { ClientCoachSelectorModal } from './client/ClientCoachSelectorModal';
import { gymKeeperIcons, type GymKeeperIcon } from './gymKeeperIcons';
import { bindTelegramBackButton, getTelegramWebApp } from './telegram';
import { Calendar, Menu, MenuDivider, MenuItem, Modal } from './ui';
import userIconUrl from './ui/icons/user.svg';

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

const HISTORY_TOKEN_KEY = '__mezfitNavigationToken';

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

function urlIconStyle(url: string): CSSProperties {
  return { '--navigation-icon': `url("${url}")` } as CSSProperties;
}

function historyStateRecord(): Record<string, unknown> {
  const state = window.history.state;
  return typeof state === 'object' && state !== null && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
}

function historyHasToken(token: string): boolean {
  return historyStateRecord()[HISTORY_TOKEN_KEY] === token;
}

interface Props {
  me: MeResponse;
  activeRole: Role;
  destination: AppDestination;
  context: NavigationContext | null;
  onDestinationChange: (destination: AppDestination) => void;
  onRoleSwitch: (role: Role) => void;
  floatingAction?: ReactNode;
  children: ReactNode;
}

export function NavigationShell({
  me,
  activeRole,
  destination,
  context,
  onDestinationChange,
  onRoleSwitch,
  floatingAction,
  children,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [coachSelectorOpen, setCoachSelectorOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => new Date());
  const contextRef = useRef(context);
  const historyEntryRef = useRef<{ context: NavigationContext; token: string } | null>(null);
  const historySequenceRef = useRef(0);
  const items = itemsForRole(activeRole);

  useEffect(() => {
    setMenuOpen(false);
    setCoachSelectorOpen(false);
  }, [activeRole]);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const requestBack = useCallback(() => {
    const currentContext = contextRef.current;
    if (!currentContext) return;
    const historyEntry = historyEntryRef.current;
    if (historyEntry && historyHasToken(historyEntry.token)) {
      window.history.back();
      return;
    }
    historyEntryRef.current = null;
    currentContext.onBack();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const currentContext = contextRef.current;
      if (!currentContext) return;
      historyEntryRef.current = null;
      currentContext.onBack();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const existingEntry = historyEntryRef.current;
    if (!context) {
      if (!existingEntry) return;
      historyEntryRef.current = null;
      if (historyHasToken(existingEntry.token)) window.history.back();
      return;
    }

    if (existingEntry?.context === context) return;
    historySequenceRef.current += 1;
    const token = `mezfit-${historySequenceRef.current}`;
    const nextState = { ...historyStateRecord(), [HISTORY_TOKEN_KEY]: token };
    if (existingEntry && historyHasToken(existingEntry.token)) {
      window.history.replaceState(nextState, '');
    } else {
      window.history.pushState(nextState, '');
    }
    historyEntryRef.current = { context, token };
  }, [context]);

  useEffect(() => bindTelegramBackButton(getTelegramWebApp(), context !== null, requestBack), [context, requestBack]);

  useEffect(() => () => {
    const existingEntry = historyEntryRef.current;
    if (!existingEntry || !historyHasToken(existingEntry.token)) return;
    const nextState = { ...historyStateRecord() };
    delete nextState[HISTORY_TOKEN_KEY];
    window.history.replaceState(nextState, '');
  }, []);

  const chooseDestination = (next: AppDestination) => {
    onDestinationChange(next);
    setMenuOpen(false);
  };

  const switchRole = (role: Role) => {
    onRoleSwitch(role);
    setMenuOpen(false);
  };

  return (
    <main className="app-shell navigation-shell">
      <header className="navigation-appbar">
        {context ? (
          <button className="navigation-icon-button" type="button" onClick={requestBack} aria-label="Назад">
            <span className="navigation-apk-icon" style={iconStyle('back')} aria-hidden="true" />
          </button>
        ) : (
          <div className="navigation-menu-anchor">
            <Menu
              isOpen={menuOpen}
              onOpenChange={setMenuOpen}
              label="Главное меню"
              className="navigation-main-menu"
              trigger={(
                <button className="navigation-icon-button" type="button" aria-label="Открыть меню">
                  <span className="navigation-apk-icon" style={iconStyle('menu')} aria-hidden="true" />
                </button>
              )}
            >
              <div className="drawer-account" role="presentation">
                <div className="drawer-avatar" aria-hidden="true">{me.user.firstName.slice(0, 1).toUpperCase()}</div>
                <div className="drawer-account-copy">
                  <strong>{[me.user.firstName, me.user.lastName].filter(Boolean).join(' ')}</strong>
                  <small>{roleLabel(activeRole)}</small>
                </div>
              </div>

              {me.roles.length > 1 ? (
                <>
                  <MenuDivider />
                  {me.roles.map((role) => (
                    <MenuItem
                      key={role}
                      active={role === activeRole}
                      onSelect={() => switchRole(role)}
                      aria-checked={role === activeRole}
                    >
                      {roleLabel(role)}
                    </MenuItem>
                  ))}
                  <MenuDivider />
                </>
              ) : null}

              {activeRole === 'client' ? (
                <MenuItem
                  leading={<span className="navigation-apk-icon" style={urlIconStyle(userIconUrl)} />}
                  onSelect={() => {
                    setMenuOpen(false);
                    setCoachSelectorOpen(true);
                  }}
                >
                  Тренер
                </MenuItem>
              ) : null}

              {items.map((item, index) => {
                const divider = item.section === 'secondary' && items[index - 1]?.section !== 'secondary';
                return (
                  <div key={item.id} className="navigation-main-menu-item">
                    {divider ? <MenuDivider /> : null}
                    <MenuItem
                      active={destination === item.id}
                      onSelect={() => chooseDestination(item.id)}
                      aria-current={destination === item.id ? 'page' : undefined}
                      leading={<span className="navigation-apk-icon" style={iconStyle(item.icon)} />}
                    >
                      {item.label}
                    </MenuItem>
                  </div>
                );
              })}
            </Menu>
          </div>
        )}
        <h1>{context?.title ?? destinationTitle(activeRole, destination)}</h1>
        <button className="navigation-icon-button" type="button" onClick={() => setCalendarOpen(true)} aria-label="Открыть календарь">
          <span className="navigation-apk-icon" style={iconStyle('calendar')} aria-hidden="true" />
        </button>
      </header>

      <section className="navigation-content">
        {children}
        {floatingAction}
      </section>

      <ClientCoachSelectorModal isOpen={coachSelectorOpen} onClose={() => setCoachSelectorOpen(false)} />

      <Modal isOpen={calendarOpen} title="Календарь" onClose={() => setCalendarOpen(false)}>
        <Calendar value={selectedDate} onChange={setSelectedDate} />
      </Modal>
    </main>
  );
}
