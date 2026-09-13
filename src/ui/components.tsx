import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadixTabs from '@radix-ui/react-tabs';
import { usePressSpot } from './PressSpot';
import { startPressScale } from './PressScale';
import './components.css';

export function List({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-list ${className}`.trim()} role="list" {...props} />;
}

type ListItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  leading?: ReactNode;
  leadingShape?: 'default' | 'square';
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  interactive?: boolean;
};

export function ListItem({ leading, leadingShape = 'default', title, subtitle, trailing, interactive = true, className = '', type = 'button', onPointerDown, disabled, ...props }: ListItemProps) {
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
  return (
    <div className="ui-list-item-wrap" role="listitem">
      {interactive ? <button type={type} className={`ui-list-item ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented) startPressSpot(event); }} {...props}>{content}</button> : <div className={`ui-list-item ui-list-item--static ${className}`.trim()}>{content}</div>}
    </div>
  );
}

type FloatingActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; isShown?: boolean; children: ReactNode };

export function FloatingActionButton({ label, isShown = true, className = '', type = 'button', children, disabled, onClick, onPointerDown, ...props }: FloatingActionButtonProps) {
  return (
    <button {...props} type={type} aria-label={label} aria-hidden={!isShown || undefined} tabIndex={isShown ? 0 : -1} disabled={disabled} onClick={isShown ? onClick : undefined} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled && isShown) startPressScale(event.currentTarget); }} className={`ui-fab${isShown ? ' ui-fab--shown' : ' ui-fab--hidden'} ${className}`.trim()}>{children}</button>
  );
}

type TabsProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Root>;
type TabsListProps = React.ComponentPropsWithoutRef<typeof RadixTabs.List>;
type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>;
type TabsContentProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Content>;
type IndicatorChildProps = { children?: ReactNode; className?: string };

export function Tabs({ className = '', ...props }: TabsProps) { return <RadixTabs.Root className={`ui-tabs ${className}`.trim()} {...props} />; }

export function TabsList({ className = '', children, style, ...props }: TabsListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [clipPath, setClipPath] = useState('inset(.25rem 100% .25rem 0 round var(--ui-tab-radius))');
  const [isIndicatorReady, setIndicatorReady] = useState(false);

  const updateIndicator = useCallback(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>(':scope > .ui-tabs__trigger[data-state="active"]');
    if (!list || !active || list.scrollWidth <= 0) {
      setClipPath('inset(.25rem 100% .25rem 0 round var(--ui-tab-radius))');
      setIndicatorReady(false);
      return;
    }
    const left = active.offsetLeft;
    const right = Math.max(0, list.scrollWidth - active.offsetLeft - active.offsetWidth);
    setClipPath(`inset(.25rem ${right}px .25rem ${left}px round var(--ui-tab-radius))`);
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

  const indicatorChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<IndicatorChildProps>;
    return <div className={`ui-tabs__indicator-tab ${element.props.className ?? ''}`.trim()}>{element.props.children}</div>;
  });

  return (
    <RadixTabs.List ref={listRef} className={`ui-tabs__list${isIndicatorReady ? ' ui-tabs__list--ready' : ''} ${className}`.trim()} style={style} {...props}>
      {children}
      <div className="ui-tabs__active-indicator" style={{ '--ui-tabs-clip-path': clipPath } as CSSProperties} aria-hidden="true">
        {indicatorChildren}
      </div>
    </RadixTabs.List>
  );
}

export function TabsTrigger({ className = '', onPointerDown, disabled, ...props }: TabsTriggerProps) { return <RadixTabs.Trigger className={`ui-tabs__trigger ${className}`.trim()} disabled={disabled} onPointerDown={(event) => { onPointerDown?.(event); if (!event.defaultPrevented && !disabled) startPressScale(event.currentTarget); }} {...props} />; }
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

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <div className={`ui-modal${isAlert ? ' ui-modal--alert' : ''} ${className}`.trim()} role="presentation">
          <div className="ui-modal__container">
            <Dialog.Overlay className="ui-modal__backdrop" onPointerDown={allowBackdropClose ? undefined : (event) => event.preventDefault()} />
            <Dialog.Content role={isAlert ? 'alertdialog' : undefined} className="ui-modal__dialog" aria-describedby={undefined} onEscapeKeyDown={blockEscape ? (event) => event.preventDefault() : undefined} onPointerDownOutside={allowBackdropClose ? undefined : (event) => event.preventDefault()} onInteractOutside={allowBackdropClose ? undefined : (event) => event.preventDefault()}>
              {title || showCloseButton ? <div className="ui-modal__header">{showCloseButton ? <Dialog.Close asChild><button className="ui-modal__close" type="button" aria-label={closeLabel} onPointerDown={(event) => startPressScale(event.currentTarget)}>×</button></Dialog.Close> : null}{title ? <Dialog.Title className="ui-modal__title">{title}</Dialog.Title> : null}</div> : null}
              {!title ? <Dialog.Title className="ui-visually-hidden">Диалог</Dialog.Title> : null}
              <div className="ui-modal__content">
                {isAlert ? <Dialog.Description asChild><div className="ui-modal__description">{children}</div></Dialog.Description> : children}
                {actions?.length ? <div className={`ui-modal__actions ui-modal__actions--${actionsLayout}`}>{actions.map((action) => <button key={action.id} type="button" className={`ui-modal__action${action.tone === 'danger' ? ' ui-modal__action--danger' : ''}`} disabled={action.disabled} onPointerDown={(event) => { if (!action.disabled) startPressScale(event.currentTarget); }} onClick={action.onClick}>{action.label}</button>)}</div> : null}
              </div>
            </Dialog.Content>
          </div>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
