import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import './menu.css';

export interface MenuProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  trigger: ReactElement;
  label?: string;
  className?: string;
  align?: 'start' | 'end';
}

export function Menu({ isOpen, onOpenChange, children, trigger, label = 'Меню', className = '', align = 'start' }: MenuProps) {
  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={onOpenChange} modal>
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

type RadixMenuItemProps = ComponentPropsWithoutRef<typeof DropdownMenu.Item>;

type MenuItemProps = Omit<RadixMenuItemProps, 'children' | 'className' | 'onSelect'> & {
  leading?: ReactNode;
  active?: boolean;
  children: ReactNode;
  className?: string;
  onSelect?: RadixMenuItemProps['onSelect'];
};

export function MenuItem({ leading, active = false, className = '', children, onSelect, ...props }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={`ui-menu-item${active ? ' ui-menu-item--active' : ''} ${className}`.trim()}
      onSelect={onSelect}
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
