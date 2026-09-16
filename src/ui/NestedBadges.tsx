import { useState, type ReactNode } from 'react';
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
  const hasChildren = Boolean(item.children?.length);
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="ui-nested-badges__branch" style={nested ? { paddingInlineStart: 'var(--ui-nested-badges-indent)' } : undefined}>
      <div className="ui-nested-badges__row">
        {hasChildren ? (
          <button
            type="button"
            className="ui-nested-badges__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <Badge color={item.color}>{item.label}</Badge>
            <span className={`ui-nested-badges__chevron${expanded ? ' ui-nested-badges__chevron--expanded' : ''}`} aria-hidden="true" />
          </button>
        ) : (
          <Badge color={item.color}>{item.label}</Badge>
        )}
        {item.info !== null && item.info !== undefined ? <Badge color="gray" className="ui-nested-badges__info">{item.info}</Badge> : null}
      </div>
      {hasChildren ? (
        <div className={`ui-nested-badges__children${expanded ? ' ui-nested-badges__children--expanded' : ''}`} aria-hidden={!expanded}>
          <div className="ui-nested-badges__children-inner">
            {item.children?.map((child) => <NestedBadgeBranch key={child.id} item={child} nested />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NestedBadges({ items }: NestedBadgesProps) {
  return <div className="ui-nested-badges">{items.map((item) => <NestedBadgeBranch key={item.id} item={item} />)}</div>;
}
