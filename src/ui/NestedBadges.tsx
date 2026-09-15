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

function NestedBadgeBranch({ item, nested = false }: { item: NestedBadgeItem; nested?: boolean }) {
  return (
    <div className="ui-nested-badges__branch" style={nested ? { paddingInlineStart: 'var(--ui-nested-badges-indent)' } : undefined}>
      <div className="ui-nested-badges__row">
        <Badge color={item.color}>{item.label}</Badge>
        {item.info !== null && item.info !== undefined ? <span className="ui-nested-badges__info">{item.info}</span> : null}
      </div>
      {item.children?.map((child) => <NestedBadgeBranch key={child.id} item={child} nested />)}
    </div>
  );
}

export function NestedBadges({ items }: NestedBadgesProps) {
  return <div className="ui-nested-badges">{items.map((item) => <NestedBadgeBranch key={item.id} item={item} />)}</div>;
}
