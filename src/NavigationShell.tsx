import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ButtonHTMLAttributes, type Dispatch, type ReactElement, type ReactNode, type SetStateAction } from 'react';
import { useDiscussions } from './discussions/DiscussionsProvider';
import { Icon, Text } from './ui';
import type { MeResponse, Role } from './api';
import { useCloudConnections, type CloudContact } from './data/cloud/CloudConnectionsProvider';
import { useCloudContactAvatarUrl } from './contacts/CloudContactAvatar';
import { ClientCoachSelectorModal } from './client/ClientCoachSelectorModal';
import { AvatarProfileNavigationContext } from './navigation/AvatarProfileNavigation';
import { NavigationSurfaceContext } from './navigation/NavigationSurfaceContext';
import { bindTelegramBackButton, getTelegramWebApp } from './telegram';
import {
  Avatar,
  DatePicker,
  FloatingActionButton,
  FloatingActionButtonGlassProvider,
  LiquidPopover,
  type LiquidPopoverItem,
  LiquidGlassFloatingActionSlot,
  LiquidGlassIconOnly,
  MEZFIT_NAVBAR_GLASS_PRESET,
  MezfitNavbar,
  type GlassPresetName,
  type DatePickerDayStatusEntry,
  type LocalDate,
  type MezfitNavbarIdentity,
  type UiIconName,
} from './ui';
import { liquidTabScale, LIQUID_TAB_BASE_HEIGHT } from './ui/liquid-glass-icon-only/adaptiveScale';
import { responsiveTypographyScale } from './ui/responsiveTypographyScale';

export type AppDestination =
  | 'clients'
  | 'programs'
  | 'discussions'
  | 'exercises'
  | 'calendar'
  | 'today'
  | 'training'
  | 'analytics'
  | 'history'
  | 'progress'
  | 'settings'
  | 'about'
  | 'profile';

export type NavigationLevel = 1 | 2;

export interface NavigationMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

type NavigationFloatingActionBase = {
  label: string;
  content?: ReactNode;
  icon?: UiIconName;
  placement?: 'left' | 'right';
  disabled?: boolean;
  isShown?: boolean;
  /** Reports the popover's full presentation, including its closing animation. */
  onPresentationChange?: (presented: boolean) => void;
};

export type NavigationFloatingAction = NavigationFloatingActionBase & (
  | { onClick: () => void; popoverItems?: never }
  | { popoverItems: readonly LiquidPopoverItem[]; onClick?: never }
);

type RegisteredFloatingAction = {
  destination: AppDestination | null;
  action: NavigationFloatingAction;
};

export interface NavigationContext {
  level?: NavigationLevel;
  title: string;
  scrollKey?: string;
  restoreScroll?: boolean;
  onBack?: () => void;
  identity?: MezfitNavbarIdentity;
  onIdentityClick?: () => void;
  menuActions?: readonly NavigationMenuAction[];
  calendar?: {
    value: LocalDate;
    onChange: (date: LocalDate) => void;
    dayStatuses?: readonly DatePickerDayStatusEntry[];
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
  { id: 'discussions', label: 'Обсуждения', icon: 'message-circle', showFab: false },
  { id: 'analytics', label: 'Аналитика', icon: 'chart-dots-2', showFab: false },
  { id: 'training', label: 'Тренировка', icon: 'barbell', showFab: false },
];

const clientPrimaryItems: NavigationItem[] = [
  { id: 'today', label: 'Сегодня', icon: 'calendar-event' },
  { id: 'training', label: 'Тренировка', icon: 'barbell' },
  { id: 'discussions', label: 'Обсуждения', icon: 'message-circle', showFab: false },
  { id: 'analytics', label: 'Аналитика', icon: 'chart-dots-2', showFab: false },
  { id: 'profile', label: 'Мой профиль', icon: 'user', showFab: false },
];

const coachSecondaryItems: NavigationItem[] = [
  { id: 'programs', label: 'Программы', icon: 'clipboard-list', section: 'secondary' },
  { id: 'profile', label: 'Мой профиль', icon: 'user', section: 'secondary', showFab: false },
  { id: 'exercises', label: 'Упражнения', icon: 'barbell', section: 'secondary', showFab: false },
  { id: 'calendar', label: 'Календарь', icon: 'calendar', section: 'secondary', showFab: false },
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary', showFab: false },
  { id: 'about', label: 'О приложении', icon: 'info-circle', section: 'secondary', showFab: false },
];

const clientSecondaryItems: NavigationItem[] = [
  { id: 'programs', label: 'Программы', icon: 'clipboard-list', section: 'secondary' },
  { id: 'settings', label: 'Настройки', icon: 'settings', section: 'secondary', showFab: false },
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

function useRegisteredNavigationFloatingAction(destination: AppDestination | null, action: NavigationFloatingAction | null): void {
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

export function useNavigationFloatingAction(destination: AppDestination, action: NavigationFloatingAction | null): void {
  useRegisteredNavigationFloatingAction(destination, action);
}

export function useNavigationSurfaceFloatingAction(action: NavigationFloatingAction | null): void {
  useRegisteredNavigationFloatingAction(null, action);
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
  /** Current coach from the client selection context; never inferred from the contact list. */
  selectedCoach?: CloudContact | null;
  destination: AppDestination;
  context: NavigationContext | null;
  onDestinationChange: (destination: AppDestination) => void;
  onAvatarProfileNavigate?: (userId: string) => void;
  onRoleSwitch: (role: Role) => void;
  floatingAction?: NavigationFloatingAction | null;
  glassPreset?: GlassPresetName;
  glassOptics?: boolean;
  previewWidth?: 320 | null;
  children: ReactNode;
}

// LiquidPopover motion values are seconds; FAB compression is fixed at 120 ms.
const FAB_LIQUID_POPOVER_MOTION = Object.freeze({ sourceMorph: 120 / 1000 });

/** The navigation slot owns FAB placement; this component owns only its popover lifecycle. */
function NavigationFloatingActionPopover({ action, glassPreset, glassOptics }: {
  action: NavigationFloatingAction;
  glassPreset: GlassPresetName;
  glassOptics: boolean;
}) {
  const triggerRef = useRef<HTMLElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <LiquidPopover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onPresentationChange={action.onPresentationChange}
      triggerActivation="controlled"
      triggerRef={triggerRef}
      label={action.label}
      items={action.popoverItems ?? []}
      preset={glassPreset}
      optics={glassOptics}
      motion={FAB_LIQUID_POPOVER_MOTION}
      trigger={
        <FloatingActionButton
          ref={triggerRef}
          label={action.label}
          icon={action.icon}
          placement={action.placement}
          disabled={action.disabled}
          isShown={action.isShown}
          onClick={() => setIsOpen(true)}
        >
          {action.content}
        </FloatingActionButton>
      }
    />
  );
}

export function NavigationShell({
  me,
  activeRole,
  selectedCoach = null,
  destination,
  context,
  onDestinationChange,
  onAvatarProfileNavigate,
  onRoleSwitch,
  floatingAction,
  glassPreset = MEZFIT_NAVBAR_GLASS_PRESET,
  glassOptics = false,
  previewWidth = null,
  children,
}: Props) {
  const cloud = useCloudConnections();
  const ownAvatarUserId = `tg:${me.user.telegramUserId}`;
  const ownAvatarName = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ');
  const ownAvatarContact = cloud?.selfAvatars?.find(contact =>
    contact.userId === ownAvatarUserId && (contact.avatarVersion || contact.userAvatar))
    ?? { userId: ownAvatarUserId, relationshipId: ownAvatarUserId,
      telegramUserId: me.user.telegramUserId, displayName: me.user.firstName };
  const ownAvatarSrc = useCloudContactAvatarUrl(ownAvatarContact) ?? me.user.photoUrl ?? undefined;
  const coachAvatarSrc = useCloudContactAvatarUrl(activeRole === 'client' ? selectedCoach : null);
  const ownAvatar = <span style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
    <Avatar size="small" name={ownAvatarName} src={ownAvatarSrc} />
  </span>;
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
  const shellRef = useRef<HTMLElement | null>(null);
  const [shellWidth, setShellWidth] = useState<number | null>(null);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const currentScrollSurfaceRef = useRef<string | null>(null);
  const restoreScrollOnNextSurfaceRef = useRef(false);
  const items = itemsForRole(activeRole);
  const primaryItems = primaryItemsForRole(activeRole);
  const secondaryItems = items.filter((item) => item.section === 'secondary');
  const currentItem = itemForDestination(activeRole, destination);
  const primaryDestination = primaryItems.some((item) => item.id === destination) ? destination : null;
  const level: NavigationLevel = nestedContext ? 2 : 1;
  const destinationFloatingAction = registeredFloatingAction?.destination === destination ? registeredFloatingAction.action : null;
  const surfaceFloatingAction = registeredFloatingAction?.destination === null ? registeredFloatingAction.action : null;
  const resolvedPrimaryFloatingAction = level === 1
    ? surfaceFloatingAction ?? destinationFloatingAction ?? (currentItem.showFab === false ? null : floatingAction ?? null)
    : null;
  const resolvedSurfaceFloatingAction = level === 2 ? surfaceFloatingAction : null;
  const nestedScrollKey = context?.scrollKey ?? (nestedContext ? `nested:${nestedContext.title}` : 'root');
  const scrollSurfaceKey = `${activeRole}:${destination}:${nestedScrollKey}`;
  const identity: MezfitNavbarIdentity = context?.identity ?? {
    title: context?.title ?? currentItem.label,
    icon: currentItem.icon,
  };
  const calendarValue = context?.calendar?.value ?? selectedDate;
  const onCalendarDateChange = context?.calendar?.onChange ?? setSelectedDate;
  const calendarDayStatuses = context?.calendar?.dayStatuses;
  const viewportContent = context?.contentMode === 'viewport';
  const liquidTabRenderScale = liquidTabScale(shellWidth ?? previewWidth ?? 406);
  const typeScale = responsiveTypographyScale(shellWidth ?? previewWidth ?? 406);

  // Portaled dialogs, hints and speech clouds render under document.body,
  // outside the app shell. Publish the same derived semantic scale at their
  // common ancestor, without changing the persisted typography presets.
  useLayoutEffect(() => {
    const root = shellRef.current?.ownerDocument.documentElement;
    if (!root) return undefined;

    const name = '--ui-responsive-type-scale';
    const previous = root.style.getPropertyValue(name);
    const previousPriority = root.style.getPropertyPriority(name);
    root.style.setProperty(name, String(typeScale));

    return () => {
      if (previous) root.style.setProperty(name, previous, previousPriority);
      else root.style.removeProperty(name);
    };
  }, [typeScale]);

  useLayoutEffect(() => {
    const element = shellRef.current;
    if (!element) return undefined;
    const syncWidth = () => {
      const width = element.clientWidth;
      if (width > 0) setShellWidth(current => current === width ? current : width);
    };
    syncWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncWidth);
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, []);

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
    if (previousSurface === scrollSurfaceKey) {
      // An overlay can complete Back on the same source scroll surface.
      // Consume that intent here so a later forward navigation still resets.
      restoreScrollOnNextSurfaceRef.current = false;
      return;
    }

    content.scrollTop = restoreScrollOnNextSurfaceRef.current || context?.restoreScroll
      ? scrollPositionsRef.current.get(scrollSurfaceKey) ?? 0
      : 0;
    restoreScrollOnNextSurfaceRef.current = false;
    currentScrollSurfaceRef.current = scrollSurfaceKey;
  }, [scrollSurfaceKey, nestedContext, context?.restoreScroll]);

  const requestBackTransition = useCallback((transition: () => void) => {
    restoreScrollOnNextSurfaceRef.current = true;
    transition();
  }, []);

  const requestBack = useCallback(() => {
    const currentContext = contextRef.current;
    if (!currentContext) return;
    setCalendarOpen(false);
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
      setCalendarOpen(false);
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
    setCalendarOpen(false);
    onDestinationChange(next);
    setMenuOpen(false);
  };

  const switchRole = (role: Role) => {
    setCalendarOpen(false);
    onRoleSwitch(role);
    setMenuOpen(false);
  };

  const { unread: discussionUnread } = useDiscussions();
  const discussionIcon = <span style={{ position: 'relative', display: 'block', width: '100%', height: '100%' }}>
    <Icon name="message-circle" />
    {discussionUnread > 0 ? <Text variant="caption" style={{ position: 'absolute', right: -8, top: -8, color: 'var(--ui-color-primary, #0a84ff)' }}>{discussionUnread}</Text> : null}
  </span>;
  const contextualMenuActions = context?.menuActions ?? [];
  const hasSystemMenu = me.roles.length > 1 || activeRole === 'client' || secondaryItems.length > 0;
  const menuItems: LiquidPopoverItem[] = activeRole === 'coach' ? [{
    id: 'destination-profile', label: 'Мой профиль', active: destination === 'profile',
    avatar: { name: ownAvatarName, src: ownAvatarSrc },
    'aria-current': destination === 'profile' ? 'page' : undefined,
    onSelect: () => chooseDestination('profile'),
  }] : [];
  menuItems.push(...contextualMenuActions.map((action, index) => ({
    id: `context-${action.id}`, label: action.label, disabled: action.disabled, onSelect: action.onSelect,
    dividerBefore: activeRole === 'coach' && index === 0,
  })));
  let systemItemsAdded = false;
  const addSystemItem = (item: LiquidPopoverItem) => {
    if (!systemItemsAdded && contextualMenuActions.length > 0 && hasSystemMenu) item.dividerBefore = true;
    systemItemsAdded = true;
    menuItems.push(item);
  };
  if (me.roles.length > 1) me.roles.forEach(role => addSystemItem({
    id: `role-${role}`, label: roleLabel(role), active: role === activeRole,
    'aria-checked': role === activeRole, onSelect: () => switchRole(role),
  }));
  if (activeRole === 'client') addSystemItem({
    id: 'coach-selector', label: 'Тренер', dividerBefore: me.roles.length > 1,
    avatar: selectedCoach ? { name: selectedCoach.displayName, src: coachAvatarSrc } : undefined,
    icon: selectedCoach ? undefined : 'user',
    onSelect: () => { setMenuOpen(false); setCoachSelectorOpen(true); },
  });
  secondaryItems.filter(item => item.id !== 'profile' && item.id !== 'calendar').forEach((item, index) => addSystemItem({
    id: `destination-${item.id}`, label: item.label, icon: item.icon, active: destination === item.id,
    'aria-current': destination === item.id ? 'page' : undefined,
    dividerBefore: index === 0 && (activeRole === 'client' || me.roles.length > 1),
    onSelect: () => chooseDestination(item.id),
  }));
  const renderFloatingAction = (action: NavigationFloatingAction) => action.popoverItems ? (
    <NavigationFloatingActionPopover
      action={action}
      glassPreset={glassPreset}
      glassOptics={glassOptics}
    />
  ) : (
    <FloatingActionButton
      label={action.label}
      icon={action.icon}
      placement={action.placement}
      disabled={action.disabled}
      isShown={action.isShown}
      onClick={action.onClick}
    >
      {action.content}
    </FloatingActionButton>
  );

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
      preset={glassPreset}
      optics={glassOptics}
    />
  );

  return (
    <FloatingActionButtonGlassProvider preset={glassPreset} optics={glassOptics}>
    <NavigationBackTransitionContext.Provider value={requestBackTransition}>
    <NavigationFloatingActionContext.Provider value={setRegisteredFloatingAction}>
      <NavigationLevelContext.Provider value={level}>
      <AvatarProfileNavigationContext.Provider value={onAvatarProfileNavigate ?? null}>
        <main
          ref={shellRef}
          className={previewWidth === 320
            ? 'app-shell navigation-shell navigation-shell--windowed'
            : 'app-shell navigation-shell'}
          data-preview-width={previewWidth ?? undefined}
          style={{ '--ui-responsive-type-scale': String(typeScale) } as CSSProperties}
        >
        <div className="navigation-navbar-frame">
          <MezfitNavbar
            level={level}
            identity={identity}
            onIdentityClick={context?.onIdentityClick ?? (activeRole === 'client' && identity.avatar ? () => chooseDestination('profile') : undefined)}
            onBack={requestBack}
            onMenu={() => setMenuOpen(true)}
            onCalendar={() => setCalendarOpen((open) => !open)}
            calendarOpen={calendarOpen}
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
          <NavigationSurfaceContext.Provider value={{ ...context, title: context?.title ?? currentItem.label, scrollKey: nestedScrollKey }}>
            {children}
          </NavigationSurfaceContext.Provider>
        </section>

        <div
          className="navigation-primary-tabs"
          style={{
            height: level === 1 ? LIQUID_TAB_BASE_HEIGHT * liquidTabRenderScale : undefined,
            pointerEvents: level === 2 ? 'none' : undefined,
          }}
        >
          <LiquidGlassIconOnly
            hidden={level !== 1}
            tabs={primaryItems.map((item) => ({
              value: item.id,
              label: item.label,
              icon: item.id === 'profile' ? { outline: ownAvatar, filled: ownAvatar }
                : item.id === 'discussions' ? { outline: discussionIcon, filled: discussionIcon } : item.icon,
            }))}
            value={primaryDestination}
            onValueChange={(value) => chooseDestination(value as AppDestination)}
            onReselect={value => { if (value === 'today') chooseDestination('today'); }}
            glassPreset={glassPreset}
            glassOptics={glassOptics}
            scale={liquidTabRenderScale}
            fab={resolvedPrimaryFloatingAction ? renderFloatingAction(resolvedPrimaryFloatingAction) : undefined}
          />
          {resolvedSurfaceFloatingAction ? (
            <LiquidGlassFloatingActionSlot>
              {renderFloatingAction(resolvedSurfaceFloatingAction)}
            </LiquidGlassFloatingActionSlot>
          ) : null}
        </div>

        <ClientCoachSelectorModal isOpen={coachSelectorOpen} onClose={() => setCoachSelectorOpen(false)} />

        <DatePicker
          opened={calendarOpen}
          surface="top-panel"
          value={calendarValue}
          onChange={onCalendarDateChange}
          onClose={() => setCalendarOpen(false)}
          glassPreset={glassPreset}
          glassOptics={glassOptics}
          dayStatuses={calendarDayStatuses}
        />
        </main>
      </AvatarProfileNavigationContext.Provider>
      </NavigationLevelContext.Provider>
    </NavigationFloatingActionContext.Provider>
    </NavigationBackTransitionContext.Provider>
    </FloatingActionButtonGlassProvider>
  );
}
