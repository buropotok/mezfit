import { Children, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadixTabs from '@radix-ui/react-tabs';
import { Dialog as KonstaDialog, DialogButton } from 'konsta/react';
import type { UiComponentTheme } from './componentTheme';
import type { UiIconPair } from './iconPair';
import { usePressSpot } from './PressSpot';
import { isPressScaleActivationKey, startPressScale } from './PressScale';
import { startSpringScale } from './SpringScale';
import { useLiquidGlassTabsController } from './LiquidGlassTabs';
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
  floatingAction?: ReactNode;
  closeLabel?: string;
  hasCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  modalColor?: boolean;
  inset?: boolean;
  onClose: () => void;
};

export function BottomSheet({ isOpen, title, children, className = '', headerLeading, floatingAction, closeLabel = 'Закрыть', hasCloseButton = true, closeOnBackdrop = true, modalColor = true, inset = false, onClose }: BottomSheetProps) {
  const blockEscape = !hasCloseButton && !closeOnBackdrop;
  const startKeyboardScale = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <div className={`ui-bottom-sheet${modalColor ? ' ui-bottom-sheet--modal-color' : ''}${inset ? ' ui-bottom-sheet--inset' : ''} ${className}`.trim()} role="presentation">
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
            <div className={`ui-bottom-sheet__content${floatingAction ? ' ui-bottom-sheet__content--with-floating-action' : ''}`}>{children}</div>
            {floatingAction ? <div className="ui-bottom-sheet__floating-action">{floatingAction}</div> : null}
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

export function TabsList({ className = '', children, style, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture, ...props }: TabsListProps) {
  const { theme, mode, activeValue } = useContext(TabsContext);
  const hasMovingIndicator = theme === 'glass' || theme === 'liquidGlass' || mode === 'icon';
  const isLiquidGlass = theme === 'liquidGlass';
  const visualLayerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const indicatorSurfaceRef = useRef<HTMLDivElement>(null);
  const [clipPath, setClipPath] = useState('inset(.25rem 100% .25rem 0 round var(--ui-tab-radius))');
  const [indicatorGeometry, setIndicatorGeometry] = useState({ left: 0, width: 0 });
  const [isIndicatorReady, setIndicatorReady] = useState(false);
  const liquidGlass = useLiquidGlassTabsController({
    enabled: isLiquidGlass,
    mode,
    activeValue,
    visualLayerRef,
    listRef,
    indicatorRef,
    indicatorSurfaceRef,
  });

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
  const listStyle = isLiquidGlass
    ? { ...style, ...liquidGlass.listStyle } as CSSProperties
    : style;

  const list = (
    <RadixTabs.List
      ref={listRef}
      className={`ui-tabs__list${isIndicatorReady ? ' ui-tabs__list--ready' : ''} ${className}`.trim()}
      style={listStyle}
      onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented) liquidGlass.handlers.onPointerDown(event); }}
      onPointerMove={(event) => { onPointerMove?.(event); if (!event.defaultPrevented) liquidGlass.handlers.onPointerMove(event); }}
      onPointerUp={(event) => { onPointerUp?.(event); if (!event.defaultPrevented) liquidGlass.handlers.onPointerUp(event); }}
      onPointerCancel={(event) => { onPointerCancel?.(event); if (!event.defaultPrevented) liquidGlass.handlers.onPointerCancel(event); }}
      onClickCapture={(event) => { onClickCapture?.(event); if (!event.defaultPrevented) liquidGlass.handlers.onClickCapture(event); }}
      {...props}
    >
      {children}
      <div ref={indicatorRef} className={`ui-tabs__active-indicator${hasMovingIndicator ? ' ui-tabs__active-indicator--moving' : ''}`} style={indicatorStyle} aria-hidden="true">
        {isLiquidGlass ? <div ref={indicatorSurfaceRef} className="ui-tabs__active-indicator-surface" /> : indicatorChildren}
      </div>
    </RadixTabs.List>
  );

  if (!isLiquidGlass) return list;

  return (
    <>
      {liquidGlass.containerFilter}
      {liquidGlass.lensFilter}
      <div ref={visualLayerRef} className="ui-tabs__liquid-layer">
        {list}
        <div ref={liquidGlass.lensRef} className="ui-tabs__press-lens" style={liquidGlass.lensStyle} aria-hidden="true" />
      </div>
    </>
  );
}

export function TabsTrigger({ icon, className = '', children, onPointerDown, onKeyDown, disabled, value, ...props }: TabsTriggerProps) {
  const { theme, mode, activeValue } = useContext(TabsContext);
  const iconRef = useRef<HTMLSpanElement>(null);
  const isActive = activeValue === value;
  const wasActiveRef = useRef(isActive);

  if (mode === 'icon' && !icon) {
    throw new Error('TabsTrigger requires both outline and filled icons when Tabs mode="icon".');
  }

  useEffect(() => {
    if (theme !== 'liquidGlass' && mode === 'icon' && isActive && !wasActiveRef.current && iconRef.current) startSpringScale(iconRef.current);
    wasActiveRef.current = isActive;
  }, [isActive, mode, theme]);

  const content = mode === 'icon' ? <>
    <span ref={iconRef} className="ui-tabs__icon" aria-hidden="true">
      <span className="ui-tabs__icon-outline">{icon?.outline}</span>
      <span className="ui-tabs__icon-filled">{icon?.filled}</span>
    </span>
    <span className="ui-tabs__label">{children}</span>
  </> : children;

  return <RadixTabs.Trigger value={value} data-ui-tab-value={value} className={`ui-tabs__trigger ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled && theme !== 'liquidGlass') startPressScale(event.currentTarget); }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && theme !== 'liquidGlass' && isPressScaleActivationKey(event.key)) startPressScale(event.currentTarget); }} {...props}>{content}</RadixTabs.Trigger>;
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
  variant?: 'default' | 'alert' | 'confirm';
  actions?: readonly ModalAction[];
  actionsLayout?: 'row' | 'column';
  onClose: () => void;
};

export function Modal({ isOpen, title, children, className = '', closeLabel = 'Закрыть', hasCloseButton, closeOnBackdrop, variant = 'default', actions, onClose }: ModalProps) {
  const titleId = useId();
  const isConfirm = variant === 'alert' || variant === 'confirm';
  const hasEnabledAction = actions?.some((action) => !action.disabled) ?? false;
  const hasExplicitDismissal = hasEnabledAction || hasCloseButton === true || closeOnBackdrop === true;
  const showAutomaticClose = hasCloseButton ?? (isConfirm ? !hasExplicitDismissal : !actions?.length);
  const allowBackdropClose = closeOnBackdrop ?? !isConfirm;
  const hasDangerAction = actions?.some((action) => action.tone === 'danger') ?? false;

  if (!isOpen) return null;

  const effectiveActions: readonly ModalAction[] = actions?.length
    ? actions
    : showAutomaticClose
      ? [{ id: 'close', label: closeLabel, tone: 'primary', onClick: onClose }]
      : [];

  const buttons = effectiveActions.length ? effectiveActions.map((action) => {
    const strong = hasDangerAction
      ? action.tone !== 'danger'
      : action.tone === 'primary' || effectiveActions.length === 1;

    return (
      <DialogButton
        key={action.id}
        strong={strong}
        disabled={action.disabled}
        onClick={action.onClick}
      >
        {action.label}
      </DialogButton>
    );
  }) : undefined;

  return (
    <KonstaDialog
      opened
      title={title ? <span id={titleId} role="heading" aria-level={2}>{title}</span> : undefined}
      buttons={buttons}
      onBackdropClick={allowBackdropClose ? onClose : undefined}
      role={isConfirm ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : 'Диалог'}
    >
      {className ? <div className={className}>{children}</div> : children}
    </KonstaDialog>
  );
}