import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './components.css';

export function List({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-list ${className}`.trim()} role="list" {...props} />;
}

type ListItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
};

export function ListItem({ leading, title, subtitle, trailing, className = '', type = 'button', ...props }: ListItemProps) {
  return (
    <button type={type} className={`ui-list-item ${className}`.trim()} role="listitem" {...props}>
      {leading ? <span className="ui-list-item__leading" aria-hidden="true">{leading}</span> : null}
      <span className="ui-list-item__content">
        <span className="ui-list-item__title">{title}</span>
        {subtitle ? <span className="ui-list-item__subtitle">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="ui-list-item__trailing">{trailing}</span> : null}
    </button>
  );
}

type FloatingActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  isShown?: boolean;
  children: ReactNode;
};

export function FloatingActionButton({ label, isShown = true, className = '', type = 'button', children, ...props }: FloatingActionButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      tabIndex={isShown ? 0 : -1}
      className={`ui-fab${isShown ? ' ui-fab--shown' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

type ModalProps = {
  isOpen: boolean;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  hasCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  onClose: () => void;
};

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ isOpen, title, children, className = '', closeLabel = 'Закрыть', hasCloseButton = true, closeOnBackdrop = true, onClose }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
    (firstFocusable ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className={`ui-modal ${className}`.trim()} role="presentation">
      <div className="ui-modal__container">
        <div className="ui-modal__backdrop" onClick={closeOnBackdrop ? onClose : undefined} aria-hidden="true" />
        <div ref={dialogRef} className="ui-modal__dialog" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1}>
          {title || hasCloseButton ? (
            <div className="ui-modal__header">
              {hasCloseButton ? <button className="ui-modal__close" type="button" aria-label={closeLabel} onClick={onClose}>×</button> : null}
              {title ? <div id={titleId} className="ui-modal__title">{title}</div> : null}
            </div>
          ) : null}
          <div className="ui-modal__content">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
