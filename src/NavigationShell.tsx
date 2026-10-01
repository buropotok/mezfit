import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MeResponse, Role } from './api';
import { ClientCoachSelectorModal } from './client/ClientCoachSelectorModal';
import { bindTelegramBackButton, getTelegramWebApp } from './telegram';
import {
  DatePicker,
  Menu,
  MenuDivider,
  MenuItem,
  MezfitNavbar,
  Tabs,
  TabsList,
  TabsTrigger,
  type LocalDate,
  type MezfitNavbarIdentity,
  type UiIconName,
} from './ui';
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

export type NavigationLevel = 1 | 2;

export interface NavigationMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface NavigationContext {
  title: string;
  onBack: () => void;
  identity?: MezfitNavbarIdentity;
  menuActions?: readonly NavigationMenuAction[];
}

interface NavigationItem {
  id: AppDestination;
  label: string;
  icon: UiIconName;
  section?: 'secondary';
}

const NavigationLevelContext = createContext<NavigationLevel>(1);
const HISTORY_TOKEN_KEY = '__mezfitNavigationToken';

const coachItems: NavigationItem[] = [
  { id: 'clients', label: 'Клиенты', icon: 'users' },
  { id: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { id: 'exercises', label: 'Упражнения', icon: 'barbell' },
  { id: 'calendar', label: 'Календарь', icon: 'calendar' },
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: 'info-circle', section: 'secondary' },
];

const clientItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: 'home' },
  { id: 'programs', label: 'Программа', icon: 'clipboard-list' },
  { id: 'exercises', label: 'Упражнения', icon: 'barbell' },
  { id: 'history', label: 'История', icon: 'clock' },
  { id: 'progress', label: 'Прогресс', icon: 'chart-dots-2' },
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary' },
  { id: 'about', label: 'О приложении', icon: 'info-circle', section: 'secondary' },
];

export function useNavigationLevel(): NavigationLevel {
  return useContext(NavigationLevelContext);
}

function itemsForRole(role: Role): NavigationItem[] {
  return role === 'coach' ? coachItems : clientItems;
}

function roleLabel(role: Role): string {
  return role === 'coach' ? 'Тренер' : 'Клиент';
}

function itemForDestination(role: Role, destination: AppDestination): NavigationItem {
  return itemsForRole(role).find((item) => item.id === destination)
    ?? { id: destination, label: 'Mezfit', icon: 'home' };
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

function todayLocalDate(): LocalDate {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const [selectedDate, setSelectedDate] = useState<LocalDate>(todayLocalDate);
  const contextRef = useRef(context);
  const historyEntryRef = useRef<{ context: NavigationContext; token: string } | null>(null);
  const historySequenceRef = useRef(0);
  const items = itemsForRole(activeRole);
  const primaryItems = items.filter((item) => item.section !== 'secondary');
  const secondaryItems = items.filter((item) => item.section === 'secondary');
  const currentItem = itemForDestination(activeRole, destination);
  const level: NavigationLevel = context ? 2 : 1;
  const identity: MezfitNavbarIdentity = context?.identity ?? {
    title: context?.title ?? currentItem.label,
    icon: currentItem.icon,
  };

  useEffect(() => {
    setMenuOpen(false);
    setCoachSelectorOpen(false);
  }, [activeRole]);

  useEffect(() => {
    contextRef.current = context;
    setMenuOpen(false);
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

  const contextualMenuActions = context?.menuActions ?? [];
  const hasSystemMenu = me.roles.length > 1 || activeRole === 'client' || secondaryItems.length > 0;

  return (
    <NavigationLevelContext.Provider value={level}>
      <main className="app-shell navigation-shell">
        <div className="navigation-navbar-frame">
          <MezfitNavbar
            level={level}
            identity={identity}
            onBack={requestBack}
            onMenu={() => setMenuOpen(true)}
            onCalendar={() => setCalendarOpen(true)}
          />
        </div>

        <div className="navigation-page-menu-anchor" aria-hidden="true">
          <Menu
            isOpen={menuOpen}
            onOpenChange={setMenuOpen}
            label="Меню страницы"
            className="navigation-main-menu"
            align="end"
            trigger={<button className="navigation-page-menu-anchor__trigger" type="button" tabIndex={-1} aria-label="Якорь меню страницы" />}
          >
            {contextualMenuActions.map((action) => (
              <MenuItem
                key={action.id}
                disabled={action.disabled}
                onSelect={action.onSelect}
              >
                {action.label}
              </MenuItem>
            ))}

            {contextualMenuActions.length > 0 && hasSystemMenu ? <MenuDivider /> : null}

            {me.roles.length > 1 ? (
              <>
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
                leading={<img className="navigation-menu-icon" src={userIconUrl} alt="" />}
                onSelect={() => {
                  setMenuOpen(false);
                  setCoachSelectorOpen(true);
                }}
              >
                Тренер
              </MenuItem>
            ) : null}

            {activeRole === 'client' && secondaryItems.length > 0 ? <MenuDivider /> : null}

            {secondaryItems.map((item) => (
              <MenuItem
                key={item.id}
                active={destination === item.id}
                onSelect={() => chooseDestination(item.id)}
                aria-current={destination === item.id ? 'page' : undefined}
              >
                {item.label}
              </MenuItem>
            ))}
          </Menu>
        </div>

        <section className={`navigation-content${level === 1 ? ' navigation-content--with-tabs' : ''}`}>
          {children}
          {floatingAction}
        </section>

        {level === 1 ? (
          <Tabs
            className="navigation-primary-tabs"
            mode="icon"
            theme="glass"
            value={destination}
            onValueChange={(value) => chooseDestination(value as AppDestination)}
          >
            <TabsList aria-label={activeRole === 'coach' ? 'Разделы тренера' : 'Разделы клиента'}>
              {primaryItems.map((item) => (
                <TabsTrigger key={item.id} value={item.id} icon={item.icon}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        <ClientCoachSelectorModal isOpen={coachSelectorOpen} onClose={() => setCoachSelectorOpen(false)} />

        <DatePicker
          opened={calendarOpen}
          value={selectedDate}
          onChange={setSelectedDate}
          onClose={() => setCalendarOpen(false)}
        />
      </main>
    </NavigationLevelContext.Provider>
  );
}
