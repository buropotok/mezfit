import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import type { MeResponse, Role } from './api';
import { ClientCoachSelectorModal } from './client/ClientCoachSelectorModal';
import { bindTelegramBackButton, getTelegramWebApp } from './telegram';
import {
  DatePicker,
  FloatingActionButton,
  FloatingActionButtonGlassProvider,
  LiquidPopover,
  type LiquidPopoverItem,
  LiquidGlassIconOnly,
  MEZFIT_NAVBAR_GLASS_PRESET,
  MezfitNavbar,
  type GlassPresetName,
  type LocalDate,
  type MezfitNavbarIdentity,
  type UiIconName,
} from './ui';

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
  content?: ReactNode;
  icon?: UiIconName;
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
  scrollKey?: string;
  onBack?: () => void;
  identity?: MezfitNavbarIdentity;
  menuActions?: readonly NavigationMenuAction[];
  calendar?: {
    value: LocalDate;
    onChange: (date: LocalDate) => void;
  };
  contentMode?: 'default' | 'viewport';
}

interface NavigationItem {
  id: AppDestination;
  label: string;
  icon: UiIconName;
  section?: 'secondary';
  showFab?: boolean;
}

const NavigationLevelContext = createContext<NavigationLevel>(1);
const NavigationBackTransitionContext = createContext<((transition: () => void) => void) | null>(null);
const NavigationFloatingActionContext = createContext<Dispatch<SetStateAction<RegisteredFloatingAction | null>> | null>(null);
const HISTORY_TOKEN_KEY = '__mezfitNavigationToken';

const coachPrimaryItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { id: 'clients', label: 'Клиенты', icon: 'users' },
  { id: 'programs', label: 'Программы', icon: 'clipboard-list' },
  { id: 'analytics', label: 'Аналитика', icon: 'chart-dots-2', showFab: false },
  { id: 'training', label: 'Тренировка', icon: 'barbell', showFab: false },
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
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary', showFab: false },
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

export function useNavigationBackTransition(): (transition: () => void) => void {
  const requestBackTransition = useContext(NavigationBackTransitionContext);
  return requestBackTransition ?? ((transition) => transition());
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
  const [menuPresented, setMenuPresented] = useState(false);
  const menuOriginRef = useRef<HTMLElement>(null);
  const [coachSelectorOpen, setCoachSelectorOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<LocalDate>(todayLocalDate);
  const [registeredFloatingAction, setRegisteredFloatingAction] = useState<RegisteredFloatingAction | null>(null);
  const nestedContext = context && (context.level ?? 2) === 2 ? context : null;
  const contextRef = useRef(nestedContext);
  const historyEntryRef = useRef<{ context: NavigationContext; token: string } | null>(null);
  const historySequenceRef = useRef(0);
  const contentRef = useRef<HTMLElement | null>(null);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const currentScrollSurfaceRef = useRef<string | null>(null);
  const restoreScrollOnNextSurfaceRef = useRef(false);
  const items = itemsForRole(activeRole);
  const primaryItems = primaryItemsForRole(activeRole);
  const secondaryItems = items.filter((item) => item.section === 'secondary');
  const currentItem = itemForDestination(activeRole, destination);
  const primaryDestination = primaryItems.some((item) => item.id === destination) ? destination : null;
  const pageFloatingAction = registeredFloatingAction?.destination === destination ? registeredFloatingAction.action : null;
  const resolvedFloatingAction = pageFloatingAction ?? floatingAction ?? null;
  const level: NavigationLevel = nestedContext ? 2 : 1;
  const nestedScrollKey = nestedContext?.scrollKey ?? (nestedContext ? `nested:${nestedContext.title}` : 'root');
  const scrollSurfaceKey = `${activeRole}:${destination}:${nestedScrollKey}`;
  const identity: MezfitNavbarIdentity = context?.identity ?? {
    title: context?.title ?? currentItem.label,
    icon: currentItem.icon,
  };
  const calendarValue = context?.calendar?.value ?? selectedDate;
  const onCalendarDateChange = context?.calendar?.onChange ?? setSelectedDate;
  const viewportContent = context?.contentMode === 'viewport';

  useEffect(() => {
    setMenuOpen(false);
    setCoachSelectorOpen(false);
  }, [activeRole]);

  useEffect(() => {
    contextRef.current = nestedContext;
    setMenuOpen(false);
  }, [nestedContext]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const previousSurface = currentScrollSurfaceRef.current;
    if (previousSurface === null) {
      currentScrollSurfaceRef.current = scrollSurfaceKey;
      content.scrollTop = 0;
      return;
    }
    if (previousSurface === scrollSurfaceKey) return;

    content.scrollTop = restoreScrollOnNextSurfaceRef.current
      ? scrollPositionsRef.current.get(scrollSurfaceKey) ?? 0
      : 0;
    restoreScrollOnNextSurfaceRef.current = false;
    currentScrollSurfaceRef.current = scrollSurfaceKey;
  }, [scrollSurfaceKey]);

  const requestBackTransition = useCallback((transition: () => void) => {
    restoreScrollOnNextSurfaceRef.current = true;
    transition();
  }, []);

  const requestBack = useCallback(() => {
    const currentContext = contextRef.current;
    if (!currentContext) return;
    const historyEntry = historyEntryRef.current;
    if (historyEntry && historyHasToken(historyEntry.token)) {
      restoreScrollOnNextSurfaceRef.current = true;
      window.history.back();
      return;
    }
    historyEntryRef.current = null;
    if (currentContext.onBack) requestBackTransition(currentContext.onBack);
  }, [requestBackTransition]);

  useEffect(() => {
    const onPopState = () => {
      const currentContext = contextRef.current;
      if (!currentContext?.onBack) return;
      historyEntryRef.current = null;
      requestBackTransition(currentContext.onBack);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [requestBackTransition]);

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
  const menuItems: LiquidPopoverItem[] = contextualMenuActions.map(action => ({
    id: `context-${action.id}`, label: action.label, disabled: action.disabled, onSelect: action.onSelect,
  }));
  const addSystemItem = (item: LiquidPopoverItem) => {
    if (menuItems.length === contextualMenuActions.length && contextualMenuActions.length > 0 && hasSystemMenu) item.dividerBefore = true;
    menuItems.push(item);
  };
  if (me.roles.length > 1) me.roles.forEach(role => addSystemItem({
    id: `role-${role}`, label: roleLabel(role), active: role === activeRole,
    'aria-checked': role === activeRole, onSelect: () => switchRole(role),
  }));
  if (activeRole === 'client') addSystemItem({
    id: 'coach-selector', label: 'Тренер', dividerBefore: me.roles.length > 1,
    onSelect: () => { setMenuOpen(false); setCoachSelectorOpen(true); },
  });
  secondaryItems.forEach((item, index) => addSystemItem({
    id: `destination-${item.id}`, label: item.label, active: destination === item.id,
    'aria-current': destination === item.id ? 'page' : undefined,
    dividerBefore: index === 0 && (activeRole === 'client' || me.roles.length > 1),
    onSelect: () => chooseDestination(item.id),
  }));
  const renderMenuControl = (control: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <LiquidPopover
      isOpen={menuOpen}
      onOpenChange={(open) => { if (!open) setMenuOpen(false); }}
      onPresentationChange={setMenuPresented}
      label="Меню страницы"
      triggerActivation="controlled"
      trigger={control}
      triggerRef={menuOriginRef}
      items={menuItems}
    />
  );

  return (
    <FloatingActionButtonGlassProvider preset={glassPreset} optics={glassOptics}>
    <NavigationBackTransitionContext.Provider value={requestBackTransition}>
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
            rightControlRef={menuOriginRef}
            rightControlHidden={menuOpen || menuPresented}
            glassPreset={glassPreset}
            glassOptics={glassOptics}
            menuDisabled={menuOpen || menuPresented}
          />
        </div>

        <section
          ref={contentRef}
          className={[
            'navigation-content',
            level === 1 ? 'navigation-content--with-tabs' : '',
            viewportContent ? 'navigation-content--viewport' : '',
          ].filter(Boolean).join(' ')}
          onScroll={(event) => {
            scrollPositionsRef.current.set(scrollSurfaceKey, event.currentTarget.scrollTop);
          }}
        >
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
                icon={resolvedFloatingAction.icon}
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
          value={calendarValue}
          onChange={onCalendarDateChange}
          onClose={() => setCalendarOpen(false)}
          glassPreset={glassPreset}
          glassOptics={glassOptics}
        />
        </main>
      </NavigationLevelContext.Provider>
    </NavigationFloatingActionContext.Provider>
    </NavigationBackTransitionContext.Provider>
    </FloatingActionButtonGlassProvider>
  );
}
