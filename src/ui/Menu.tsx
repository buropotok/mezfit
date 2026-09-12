import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './menu.css';

export interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  label?: string;
  className?: string;
  align?: 'start' | 'end';
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export function Menu({ isOpen, onClose, children, label = 'Меню', className = '', align = 'start', returnFocusRef }: MenuProps) {
  const [mounted, setMounted] = useState(isOpen);
  const [visible, setVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (isOpen) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      closeTimerRef.current = null;
      returnFocusRef?.current?.focus();
    }, 200);
  }, [isOpen, returnFocusRef]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
    const frame = window.requestAnimationFrame(() => focusable()[0]?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mounted, onClose]);

  if (!mounted) return null;
  return (
    <div className={`ui-menu-layer ${visible ? 'ui-menu-layer--open' : 'ui-menu-layer--closing'}`}>
      <button className="ui-menu-backdrop" type="button" aria-label="Закрыть меню" onClick={onClose} />
      <div ref={menuRef} className={`ui-menu ui-menu--${align} ${className}`.trim()} role="menu" aria-label={label}>{children}</div>
    </div>
  );
}

type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & { leading?: ReactNode; active?: boolean; children: ReactNode };
export function MenuItem({ leading, active = false, className = '', type = 'button', children, ...props }: MenuItemProps) {
  return <button type={type} role="menuitem" className={`ui-menu-item${active ? ' ui-menu-item--active' : ''} ${className}`.trim()} {...props}>{leading ? <span className="ui-menu-item__leading" aria-hidden="true">{leading}</span> : null}<span className="ui-menu-item__label">{children}</span></button>;
}

export function MenuDivider() { return <div className="ui-menu-divider" role="separator" />; }
