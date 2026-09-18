import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadixTabs from '@radix-ui/react-tabs';
import type { UiComponentTheme } from './componentTheme';
import type { UiIconPair } from './iconPair';
import { usePressSpot } from './PressSpot';
import { isPressScaleActivationKey, startPressScale } from './PressScale';
import { startSpringScale } from './SpringScale';
import './components.css';

type ListDivider = 'none' | 'inset' | 'full';
type ListProps = HTMLAttributes<HTMLDivElement> & { divider?: ListDivider };

export function List({ divider = 'none', className = '', ...props }: ListProps) {
  const dividerClassName = divider === 'none' ? '' : ` ui-list--divider-${divider}`;
  return <div className={`ui-list${dividerClassName} ${className}`.trim()} role="list" {...props} />;
}

export type ListItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  leading?: ReactNode;
  leadingShape?: 'default' | 'square';
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  trailingAction?: ReactNode;
  interactive?: boolean;
};

export function ListItem({ leading, leadingShape = 'default', title, subtitle, trailing, trailingAction, interactive = true, className = '', type = 'button', onPointerDown, disabled, ...props }: ListItemProps) {
  const { pressSpot, startPressSpot } = usePressSpot<HTMLButtonElement>(disabled || !interactive);
  const leadingClassName = leadingShape === 'square' ? ' ui-list-item__leading--square' : '';
  const content = <>
    {pressSpot}
    {leading ? <span className={`ui-list-item__leading${leadingClassName}`} aria-hidden="true">{leading}</span> : null}
    <span className="ui-list-item__content">
      <span className="ui-list-item__title">{title}</span>
      {subtitle ? <span className="ui-list-item__subtitle">{subtitle}</span> : null}
    </span>
    {trailing ? <span className="ui-list-item__trailing">{trailing}</span> : null}
  </>;
  const actionClassName = trailingAction ? ' ui-list-item-wrap--with-action' : '';
  return (
    <div className={`ui-list-item-wrap${actionClassName}`} role="listitem">
      {interactive ? <button type={type} className={`ui-list-item ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented) startPressSpot(event); }} {...props}>{content}</button> : <div className={`ui-list-item ui-list-item--static ${className}`.trim()}>{content}</div>}
      {trailingAction ? <span className="ui-list-item__trailing-action">{trailingAction}</span> : null}
    </div>
  );
}

export type BottomSheetProps = {
  isOpen: boolean;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  headerLeading?: ReactNode;
  closeLabel?: string;
  hasCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  modalColor?: boolean;
  onClose: () => void;
};

export function BottomSheet({ isOpen, title, children, className = '', headerLeading, closeLabel = 'Закрыть', hasCloseButton = true, closeOnBackdrop = true, modalColor = true, onClose }: BottomSheetProps) {
  const blockEscape = !hasCloseButton && !closeOnBackdrop;
  const startKeyboardScale = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <div className={`ui-bottom-sheet${modalColor ? ' ui-bottom-sheet--modal-color' : ''} ${className}`.trim()} role="presentation">
          <Dialog.Overlay className="ui-bottom-sheet__backdrop" onPointerDown={closeOnBackdrop ? undefined : (event) => event.preventDefault()} />
          <Dialog.Content
            className="ui-bottom-sheet__panel"
            aria-describedby={undefined}
            onEscapeKeyDown={blockEscape ? (event) => event.preventDefault() : undefined}
            onPointerDownOutside={closeOnBackdrop ? undefined : (event) => event.preventDefault()}
            onInteractOutside={closeOnBackdrop ? undefined : (event) => event.preventDefault()}
          >
            {title || hasCloseButton || headerLeading ? (
              <div className="ui-bottom-sheet__header">
                {headerLeading ? <span className="ui-bottom-sheet__header-leading">{headerLeading}</span> : null}
                {hasCloseButton ? <Dialog.Close asChild><button className="ui-bottom-sheet__close" type="button" aria-label={closeLabel} onPointerDown={(event) => startPressScale(event.currentTarget)} onKeyDown={startKeyboardScale}>×</button></Dialog.Close> : null}
                {title ? <Dialog.Title className="ui-bottom-sheet__title">{title}</Dialog.Title> : null}
              </div>
            ) : null}
            {!title ? <Dialog.Title className="ui-visually-hidden">Панель</Dialog.Title> : null}
            <div className="ui-bottom-sheet__content">{children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type FloatingActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; isShown?: boolean; placement?: 'left' | 'right'; children: ReactNode };

export function FloatingActionButton({ label, isShown = true, placement = 'right', className = '', type = 'button', children, disabled, onClick, onPointerDown, onKeyDown, ...props }: FloatingActionButtonProps) {
  return (
    <button {...props} type={type} aria-label={label} aria-hidden={!isShown || undefined} tabIndex={isShown ? 0 : -1} disabled={disabled} onClick={isShown ? onClick : undefined} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled && isShown) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isShown && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} className={`ui-fab ui-fab--${placement}${isShown ? ' ui-fab--shown' : ' ui-fab--hidden'} ${className}`.trim()}>{children}</button>
  );
}

export type TabsMode = 'default' | 'icon';
export type TabsIconPair = UiIconPair;
export type TabsProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Root> & { theme?: UiComponentTheme; mode?: TabsMode };
type TabsListProps = React.ComponentPropsWithoutRef<typeof RadixTabs.List>;
export type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger> & { icon?: TabsIconPair };
type TabsContentProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Content>;
type IndicatorChildProps = { children?: ReactNode; className?: string };
type TabsContextValue = { theme: UiComponentTheme; mode: TabsMode; activeValue?: string };

const TabsContext = createContext<TabsContextValue>({ theme: 'default', mode: 'default' });

export function Tabs({ theme = 'default', mode = 'default', className = '', value, defaultValue, onValueChange, ...props }: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const activeValue = value ?? uncontrolledValue;
  const handleValueChange = useCallback((nextValue: string) => {
    if (value === undefined) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  }, [onValueChange, value]);

  return (
    <TabsContext.Provider value={{ theme, mode, activeValue }}>
      <RadixTabs.Root {...props} value={value} defaultValue={defaultValue} onValueChange={handleValueChange} data-ui-theme={theme} data-ui-mode={mode} className={`ui-tabs ${className}`.trim()} />
    </TabsContext.Provider>
  );
}

export function TabsList({ className = '', children, style, ...props }: TabsListProps) {
  const { theme, mode } = useContext(TabsContext);
  const hasMovingIndicator = theme === 'glass' || mode === 'icon';
  const listRef = useRef<HTMLDivElement>(null);
  const [clipPath, setClipPath] = useState('inset(.25rem 100% .25rem 0 round var(--ui-tab-radius))');
  const [indicatorGeometry, setIndicatorGeometry] = useState({ left: 0, width: 0 });
  const [isIndicatorReady, setIndicatorReady] = useState(false);

  const updateIndicator = useCallback(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>(':scope > .ui-tabs__trigger[data-state="active"]');
    if (!list || !active || list.scrollWidth <= 0) {
      setClipPath('inset(.25rem 100% .25rem 0 round var(--ui-tab-radius))');
      setIndicatorGeometry({ left: 0, width: 0 });
      setIndicatorReady(false);
      return;
    }
    const left = active.offsetLeft;
    const right = Math.max(0, list.scrollWidth - active.offsetLeft - active.offsetWidth);
    setClipPath(`inset(.25rem ${right}px .25rem ${left}px round var(--ui-tab-radius))`);
    setIndicatorGeometry({ left, width: active.offsetWidth });
    setIndicatorReady(true);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    updateIndicator();
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(list);
    const mutationObserver = new MutationObserver(updateIndicator);
    mutationObserver.observe(list, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [children, updateIndicator]);

  const indicatorChildren = hasMovingIndicator ? null : Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<IndicatorChildProps>;
    return <div className={`ui-tabs__indicator-tab ${element.props.className ?? ''}`.trim()}>{element.props.children}</div>;
  });
  const indicatorStyle = hasMovingIndicator
    ? { '--ui-tabs-indicator-left': `${indicatorGeometry.left}px`, '--ui-tabs-indicator-width': `${indicatorGeometry.width}px` } as CSSProperties
    : { '--ui-tabs-clip-path': clipPath } as CSSProperties;

  return (
    <RadixTabs.List ref={listRef} className={`ui-tabs__list${isIndicatorReady ? ' ui-tabs__list--ready' : ''} ${className}`.trim()} style={style} {...props}>
      {children}
      <div className={`ui-tabs__active-indicator${hasMovingIndicator ? ' ui-tabs__active-indicator--moving' : ''}`} style={indicatorStyle} aria-hidden="true">
        {indicatorChildren}
      </div>
    </RadixTabs.List>
  );
}

export function TabsTrigger({ icon, className = '', children, onPointerDown, onKeyDown, disabled, value, ...props }: TabsTriggerProps) {
  const { mode, activeValue } = useContext(TabsContext);
  const iconRef = useRef<HTMLSpanElement>(null);
  const isActive = activeValue === value;
  const wasActiveRef = useRef(isActive);

  if (mode === 'icon' && !icon) {
    throw new Error('TabsTrigger requires both outline and filled icons when Tabs mode="icon".');
  }

  useEffect(() => {
    if (mode === 'icon' && isActive && !wasActiveRef.current && iconRef.current) startSpringScale(iconRef.current);
    wasActiveRef.current = isActive;
  }, [isActive, mode]);

  const content = mode === 'icon' ? <>
    <span ref={iconRef} className="ui-tabs__icon" aria-hidden="true">
      <span className="ui-tabs__icon-outline">{icon?.outline}</span>
      <span className="ui-tabs__icon-filled">{icon?.filled}</span>
    </span>
    <span className="ui-tabs__label">{children}</span>
  </> : children;

  return <RadixTabs.Trigger value={value} className={`ui-tabs__trigger ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props}>{content}</RadixTabs.Trigger>;
}
export function TabsContent({ className = '', ...props }: TabsContentProps) { return <RadixTabs.Content className={`ui-tabs__content ${className}`.trim()} {...props} />; }

export type ModalAction = {
  id: string;
  label: ReactNode;
  onClick: () => void;
  tone?: 'primary' | 'danger';
  disabled?: boolean;
};

type ModalProps = {
  isOpen: boolean;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  hasCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  variant?: 'default' | 'alert';
  actions?: readonly ModalAction[];
  actionsLayout?: 'row' | 'column';
  onClose: () => void;
};

export function Modal({ isOpen, title, children, className = '', closeLabel = 'Закрыть', hasCloseButton, closeOnBackdrop, variant = 'default', actions, actionsLayout = 'row', onClose }: ModalProps) {
  const isAlert = variant === 'alert';
  const hasEnabledAction = actions?.some((action) => !action.disabled) ?? false;
  const hasAlertDismissal = hasEnabledAction || hasCloseButton === true || closeOnBackdrop === true;
  const showCloseButton = hasCloseButton ?? (isAlert ? !hasAlertDismissal : true);
  const allowBackdropClose = closeOnBackdrop ?? !isAlert;
  const blockEscape = isAlert && (hasEnabledAction || allowBackdropClose || showCloseButton);
  const startKeyboardScale = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <div className={`ui-modal${isAlert ? ' ui-modal--alert' : ''} ${className}`.trim()} role="presentation">
          <div className="ui-modal__container">
            <Dialog.Overlay className="ui-modal__backdrop" onPointerDown={allowBackdropClose ? undefined : (event) => event.preventDefault()} />
            <Dialog.Content role={isAlert ? 'alertdialog' : undefined} className="ui-modal__dialog" aria-describedby={undefined} onEscapeKeyDown={blockEscape ? (event) => event.preventDefault() : undefined} onPointerDownOutside={allowBackdropClose ? undefined : (event) => event.preventDefault()} onInteractOutside={allowBackdropClose ? undefined : (event) => event.preventDefault()}>
              {title || showCloseButton ? <div className="ui-modal__header">{showCloseButton ? <Dialog.Close asChild><button className="ui-modal__close" type="button" aria-label={closeLabel} onPointerDown={(event) => startPressScale(event.currentTarget)} onKeyDown={startKeyboardScale}>×</button></Dialog.Close> : null}{title ? <Dialog.Title className="ui-modal__title">{title}</Dialog.Title> : null}</div> : null}
              {!title ? <Dialog.Title className="ui-visually-hidden">Диалог</Dialog.Title> : null}
              <div className="ui-modal__content">
                {isAlert ? <Dialog.Description asChild><div className="ui-modal__description">{children}</div></Dialog.Description> : children}
                {actions?.length ? <div className={`ui-modal__actions ui-modal__actions--${actionsLayout}`}>{actions.map((action) => <button key={action.id} type="button" className={`ui-modal__action${action.tone === 'danger' ? ' ui-modal__action--danger' : ''}`} disabled={action.disabled} onPointerDown={(event) => { if (!action.disabled) startPressScale(event.currentTarget); }} onKeyDown={(event) => { if (!action.disabled) startKeyboardScale(event); }} onClick={action.onClick}>{action.label}</button>)}</div> : null}
              </div>
            </Dialog.Content>
          </div>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
