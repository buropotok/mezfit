import { Children, type HTMLAttributes, type ReactNode } from 'react';
import './compact-action-group.css';

/** Right-aligned, gapless 44px action slots. Slots contain independent UI Kit controls. */
export type CompactActionGroupProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: ReactNode;
};

export function CompactActionGroup({ children, className = '', ...props }: CompactActionGroupProps) {
  const actions = Children.toArray(children);
  if (actions.length === 0) return null;
  return <span role="group" className={`ui-compact-action-group ${className}`.trim()} {...props}>
    {actions.map((action, index) => <span className="ui-compact-action-group__slot" key={index}>{action}</span>)}
  </span>;
}
