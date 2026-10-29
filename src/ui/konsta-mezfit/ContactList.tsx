import type { ReactNode } from 'react';
import { List, ListGroup, ListItem } from 'konsta/react';

// Konsta 5.4.0 supports overriding group-title colors through public props.
// Keep its native list/group/item layout and sticky header mechanics.
const groupTitleColors = {
  groupTitleBgIos: 'bg-transparent dark:bg-transparent',
  groupTitleBgMaterial: 'bg-transparent dark:bg-transparent',
  secondaryTextIos: 'text-white',
  secondaryTextMaterial: 'text-white',
};

export function MezfitContactList({ children }: { children: ReactNode }) {
  return <List dividers={false}>{children}</List>;
}

export function MezfitContactListGroup({ title, children }: { title: string; children: ReactNode }) {
  return <ListGroup>
    <ListItem groupTitle className="sticky top-0 gap-3" colors={groupTitleColors}
      title={<>{title}<span aria-hidden="true" className="h-px flex-1 bg-white" /></>} />
    {children}
  </ListGroup>;
}
