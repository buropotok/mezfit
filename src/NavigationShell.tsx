import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import type { MeResponse, Role } from './api';
import { ClientCoachSelectorModal } from './client/ClientCoachSelectorModal';
import { bindTelegramBackButton, getTelegramWebApp } from './telegram';
import {
  DatePicker,
  FloatingActionButton,
  Menu,
  MenuDivider,
  MenuItem,
  LiquidGlassIconOnly,
  MEZFIT_NAVBAR_GLASS_PRESET,
  MezfitNavbar,
  type GlassPresetName,
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
  | 'training'
  | 'analytics'
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

export interface NavigationFloatingAction {
  label: string;
  onClick: () => void;
  content: ReactNode;
  placement?: 'left' | 'right';
  disabled?: boolean;
  isShown?: boolean;
}

type RegisteredFloatingAction = {
  destination: AppDestination;
  action: NavigationFloatingAction;
};

export interface NavigationContext {
  level?: NavigationLevel;
  title: string;
  onBack?: () => void;
  identity?: MezfitNavbarIdentity;
  menuActions?: readonly NavigationMenuAction[];
}

interface NavigationItem {
  id: AppDestination;
  label: string;
  icon: UiIconName;
  section?: 'secondary';
  showFab?: boolean;
}

const NavigationLevelContext = createContext<NavigationLevel>(1);
const NavigationFloatingActionContext = createContext<Dispatch<SetStateAction<RegisteredFloatingAction | null>> | null>(null);
const HISTORY_TOKEN_KEY = '__mezfitNavigationToken';

const coachPrimaryItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { id: 'clients', label: 'Клиенты', icon: 'users' },
  { id: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { id: 'analytics', label: 'Аналитика', icon: 'chart-dots-2', showFab: false },
  { id: 'settings', label: 'Настройки', icon: 'settings', showFab: false },
];

const clientPrimaryItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { id: 'training', label: 'Тренировка', icon: 'barbell' },
  { id: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { id: 'analytics', label: 'Аналитика', icon: 'chart-dots-2', showFab: false },
  { id: 'settings', label: 'Настройки', icon: 'settings', showFab: false },
];

const coachSecondaryItems: NavigationItem[] = [
  { id: 'exercises', label: 'Упражнения', icon: 'barbell', section: 'secondary', showFab: false },
  { id: 'calendar', label: 'Календарь', icon: 'calendar', section: 'secondary', showFab: false },
  { id: 'about', label: 'О приложении', icon: 'info-circle', section: 'secondary', showFab: false },
];

const clientSecondaryItems: NavigationItem[] = [
  { id: 'exercises', label: 'Упражнения', icon: 'barbell', section: 'secondary', showFab: false },
  { id: 'history', label: 'История', icon: 'clock', section: 'secondary', showFab: false },
  { id: 'progress', label: 'Прогресс', icon: 'chart-dots-2', section: 'secondary', showFab: false },
  { id: 'about', label: 'О приложении', icon: 'info-circle', section: 'secondary', showFab: false },
];

const coachItems: NavigationItem[] = [...coachPrimaryItems, ...coachSecondaryItems];
const clientItems: NavigationItem[] = [...clientPrimaryItems, ...clientSecondaryItems];

export function useNavigationLevel(): NavigationLevel {
  return useContext(NavigationLevelContext);
}

export function useNavigationFloatingAction(destination: AppDestination, action: NavigationFloatingAction | null): void {
  const setFloatingAction = useContext(NavigationFloatingActionContext);

  useLayoutEffect(() => {
    if (!setFloatingAction) return undefined;
    if (!action) {
      setFloatingAction((current) => current?.destination === destination ? null : current);
      return undefined;
    }

    const registration: RegisteredFloatingAction = { destination, action };
    setFloatingAction(registration);
    return () => {
      setFloatingAction((current) => current === registration ? null : current);
    };
  }, [action, destination, setFloatingAction]);
}

function itemsForRole(role: Role): NavigationItem[] {
  return role === 'coach' ? coachItems : clientItems;
}

function primaryItemsForRole(role: Role): NavigationItem[] {
  return role === 'coach' ? coachPrimaryItems : clientPrimaryItems;
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
  floatingAction?: NavigationFloatingAction | null;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
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
  glassPreset = MEZFIT_NAVBAR_GLASS_PRESET,
  glassOptics = false,
  children,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [coachSelectorOpen, setCoachSelectorOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<LocalDate>(todayLocalDate);
  const [registeredFloatingAction, setRegisteredFloatingAction] = useState<RegisteredFloatingAction | null>(null);
  const nestedContext = context && (context.level ?? 2) === 2 ? context : null;
  const contextRef = useRef(nestedContext);
  const historyEntryRef = useRef<{ context: NavigationContext; token: string } | null>(null);
  const historySequenceRef = useRef(0);
  const items = itemsForRole(activeRole);
  const primaryItems = primaryItemsForRole(activeRole);
  const secondaryItems = items.filter((item) => item.section === 'secondary');
  const currentItem = itemForDestination(activeRole, destination);
  const primaryDestination = primaryItems.some((item) => item.id === destination) ? destination : null;
  const pageFloatingAction = registeredFloatingAction?.destination === destination ? registeredFloatingAction.action : null;
  const resolvedFloatingAction = pageFloatingAction ?? floatingAction ?? null;
  const level: NavigationLevel = nestedContext ? 2 : 1;
  const identity: MezfitNavbarIdentity = context?.identity ?? {
    title: context?.title ?? currentItem.label,
    icon: currentItem.icon,
  };

  useEffect(() => {
    setMenuOpen(false);
    setCoachSelectorOpen(false);
  }, [activeRole]);

  useEffect(() => {
    contextRef.current = nestedContext;
    setMenuOpen(false);
  }, [nestedContext]);

  const requestBack = useCallback(() => {
    const currentContext = contextRef.current;
    if (!currentContext) return;
    const historyEntry = historyEntryRef.current;
    if (historyEntry && historyHasToken(historyEntry.token)) {
      window.history.back();
      return;
    }
    historyEntryRef.current = null;
    currentContext.onBack?.();
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const currentContext = contextRef.current;
      if (!currentContext) return;
      historyEntryRef.current = null;
      currentContext.onBack?.();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const existingEntry = historyEntryRef.current;
    if (!nestedContext) {
      if (!existingEntry) return;
      historyEntryRef.current = null;
      if (historyHasToken(existingEntry.token)) window.history.back();
      return;
    }

    if (existingEntry?.context === nestedContext) return;
    historySequenceRef.current += 1;
    const token = `mezfit-${historySequenceRef.current}`;
    const nextState = { ...historyStateRecord(), [HISTORY_TOKEN_KEY]: token };
    if (existingEntry && historyHasToken(existingEntry.token)) {
      window.history.replaceState(nextState, '');
    } else {
      window.history.pushState(nextState, '');
    }
    historyEntryRef.current = { context: nestedContext, token };
  }, [nestedContext]);

  useEffect(
    () => bindTelegramBackButton(getTelegramWebApp(), nestedContext !== null, requestBack),
    [nestedContext, requestBack],
  );

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
  const renderMenuControl = (control: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <Menu
      isOpen={menuOpen}
      onOpenChange={(open) => {
        if (!open) setMenuOpen(false);
      }}
      label="Меню страницы"
      className="navigation-main-menu"
      align="end"
      trigger={control}
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
  );

  return (
    <NavigationFloatingActionContext.Provider value={setRegisteredFloatingAction}>
      <NavigationLevelContext.Provider value={level}>
        <main className="app-shell navigation-shell">
        <div className="navigation-navbar-frame">
          <MezfitNavbar
            level={level}
            identity={identity}
            onBack={requestBack}
            onMenu={() => setMenuOpen(true)}
            onCalendar={() => setCalendarOpen(true)}
            renderMenuControl={renderMenuControl}
            glassPreset={glassPreset}
            glassOptics={glassOptics}
            menuDisabled={menuOpen}
          />
        </div>

        <section className={`navigation-content${level === 1 ? ' navigation-content--with-tabs' : ''}`}>
          {children}
        </section>

        <div className="navigation-primary-tabs">
          <LiquidGlassIconOnly
            hidden={level !== 1}
            tabs={primaryItems.map((item) => ({
              value: item.id,
              label: item.label,
              icon: item.icon,
            }))}
            value={primaryDestination}
            onValueChange={(value) => chooseDestination(value as AppDestination)}
            glassPreset={glassPreset}
            glassOptics={glassOptics}
            fab={currentItem.showFab === false || !resolvedFloatingAction ? undefined : (
              <FloatingActionButton
                label={resolvedFloatingAction.label}
                placement={resolvedFloatingAction.placement}
                disabled={resolvedFloatingAction.disabled}
                isShown={resolvedFloatingAction.isShown}
                onClick={resolvedFloatingAction.onClick}
              >
                {resolvedFloatingAction.content}
              </FloatingActionButton>
            )}
          />
        </div>

        <ClientCoachSelectorModal isOpen={coachSelectorOpen} onClose={() => setCoachSelectorOpen(false)} />

        <DatePicker
          opened={calendarOpen}
          value={selectedDate}
          onChange={setSelectedDate}
          onClose={() => setCalendarOpen(false)}
        />
        </main>
      </NavigationLevelContext.Provider>
    </NavigationFloatingActionContext.Provider>
  );
}
