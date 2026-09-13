import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadixTabs from '@radix-ui/react-tabs';
import { RippleEffect } from './RippleEffect';
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

export function ListItem({ leading, leadingShape = 'default', title, subtitle, trailing, interactive = true, className = '', type = 'button', ...props }: ListItemProps) {
  const leadingClassName = leadingShape === 'square' ? ' ui-list-item__leading--square' : '';
  const content = <>
    {interactive && !props.disabled ? <RippleEffect /> : null}
    {leading ? <span className={`ui-list-item__leading${leadingClassName}`} aria-hidden="true">{leading}</span> : null}
    <span className="ui-list-item__content">
      <span className="ui-list-item__title">{title}</span>
      {subtitle ? <span className="ui-list-item__subtitle">{subtitle}</span> : null}
    </span>
    {trailing ? <span className="ui-list-item__trailing">{trailing}</span> : null}
  </>;
  return (
    <div className="ui-list-item-wrap" role="listitem">
      {interactive ? <button type={type} className={`ui-list-item ${className}`.trim()} {...props}>{content}</button> : <div className={`ui-list-item ui-list-item--static ${className}`.trim()}>{content}</div>}
    </div>
  );
}

type FloatingActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; isShown?: boolean; children: ReactNode };

export function FloatingActionButton({ label, isShown = true, className = '', type = 'button', children, disabled, onClick, ...props }: FloatingActionButtonProps) {
  return (
    <button {...props} type={type} aria-label={label} aria-hidden={!isShown || undefined} tabIndex={isShown ? 0 : -1} disabled={disabled} onClick={isShown ? onClick : undefined} className={`ui-fab${isShown ? ' ui-fab--shown' : ' ui-fab--hidden'} ${className}`.trim()}>{children}</button>
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

export function TabsTrigger({ className = '', ...props }: TabsTriggerProps) { return <RadixTabs.Trigger className={`ui-tabs__trigger ${className}`.trim()} {...props} />; }
export function TabsContent({ className = '', ...props }: TabsContentProps) { return <RadixTabs.Content className={`ui-tabs__content ${className}`.trim()} {...props} />; }

type ModalProps = { isOpen: boolean; title?: ReactNode; children: ReactNode; className?: string; closeLabel?: string; hasCloseButton?: boolean; closeOnBackdrop?: boolean; onClose: () => void; };
export function Modal({ isOpen, title, children, className = '', closeLabel = 'Закрыть', hasCloseButton = true, closeOnBackdrop = true, onClose }: ModalProps) {
  return <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><div className={`ui-modal ${className}`.trim()} role="presentation"><div className="ui-modal__container"><Dialog.Overlay className="ui-modal__backdrop" onPointerDown={closeOnBackdrop ? undefined : (event) => event.preventDefault()} /><Dialog.Content className="ui-modal__dialog" aria-describedby={undefined} onPointerDownOutside={closeOnBackdrop ? undefined : (event) => event.preventDefault()} onInteractOutside={closeOnBackdrop ? undefined : (event) => event.preventDefault()}>{title || hasCloseButton ? <div className="ui-modal__header">{hasCloseButton ? <Dialog.Close asChild><button className="ui-modal__close" type="button" aria-label={closeLabel}>×</button></Dialog.Close> : null}{title ? <Dialog.Title className="ui-modal__title">{title}</Dialog.Title> : null}</div> : null}{!title ? <Dialog.Title className="ui-visually-hidden">Диалог</Dialog.Title> : null}<div className="ui-modal__content">{children}</div></Dialog.Content></div></div></Dialog.Portal></Dialog.Root>;
}
