import type { ReactNode } from 'react';
import { Badge, type BadgeColor } from './Badge';
import './NestedBadges.css';

export type NestedBadgeItem = {
  id: string;
  label: ReactNode;
  color?: BadgeColor;
  info?: ReactNode;
  children?: NestedBadgeItem[];
};

export type NestedBadgesProps = {
  items: NestedBadgeItem[];
};

function NestedBadgeBranch({ item, depth }: { item: NestedBadgeItem; depth: number }) {
  return (
    <div className="ui-nested-badges__branch" style={{ paddingInlineStart: `calc(${depth} * var(--ui-nested-badges-indent))` }}>
      <div className="ui-nested-badges__row">
        <Badge color={item.color}>{item.label}</Badge>
        {item.info ? <span className="ui-nested-badges__info">{item.info}</span> : null}
      </div>
      {item.children?.map((child) => <NestedBadgeBranch key={child.id} item={child} depth={depth + 1} />)}
    </div>
  );
}

export function NestedBadges({ items }: NestedBadgesProps) {
  return <div className="ui-nested-badges">{items.map((item) => <NestedBadgeBranch key={item.id} item={item} depth={0} />)}</div>;
}
