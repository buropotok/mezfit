import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import './menu.css';

export interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  trigger: ReactElement;
  label?: string;
  className?: string;
  align?: 'start' | 'end';
}

export function Menu({ isOpen, onClose, children, trigger, label = 'Меню', className = '', align = 'start' }: MenuProps) {
  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} modal>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`ui-menu ${className}`.trim()}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          aria-label={label}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & {
  leading?: ReactNode;
  active?: boolean;
  children: ReactNode;
  onSelect?: () => void;
};

export function MenuItem({ leading, active = false, className = '', children, disabled, onSelect, onClick, ...props }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={`ui-menu-item${active ? ' ui-menu-item--active' : ''} ${className}`.trim()}
      disabled={disabled}
      onSelect={(event) => {
        onSelect?.();
        if (onClick) onClick(event as unknown as React.MouseEvent<HTMLButtonElement>);
      }}
      {...props}
    >
      {leading ? <span className="ui-menu-item__leading" aria-hidden="true">{leading}</span> : null}
      <span className="ui-menu-item__label">{children}</span>
    </DropdownMenu.Item>
  );
}

export function MenuDivider() {
  return <DropdownMenu.Separator className="ui-menu-divider" />;
}
