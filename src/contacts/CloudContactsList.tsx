import { List, ListGroup, ListItem } from 'konsta/react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CloudContactAvatar } from './CloudContactAvatar';

function displayName(client: CloudContact): string { return client.displayName; }

const clientNameCollator = new Intl.Collator(['ru-RU', 'en-US'], {
  sensitivity: 'base',
  numeric: true,
});

function clientSortName(client: CloudContact): string {
  return displayName(client).trim() || 'Клиент Mezfit';
}

function clientGroupTitle(client: CloudContact): string {
  const [firstCharacter = ''] = Array.from(clientSortName(client).normalize('NFC'));
  if (!firstCharacter || !/^\p{L}$/u.test(firstCharacter)) return '#';

  const [upperCharacter = firstCharacter] = Array.from(firstCharacter.toLocaleUpperCase('ru-RU'));
  return upperCharacter;
}

function groupClientsForContacts(clients: CloudContact[]): Array<{ title: string; clients: CloudContact[] }> {
  const groups = new Map<string, CloudContact[]>();

  for (const client of [...clients].sort((left, right) => clientNameCollator.compare(clientSortName(left), clientSortName(right)))) {
    const title = clientGroupTitle(client);
    const group = groups.get(title);
    if (group) group.push(client);
    else groups.set(title, [client]);
  }

  return Array.from(groups, ([title, groupedClients]) => ({ title, clients: groupedClients }))
    .sort((left, right) => {
      if (left.title === '#') return 1;
      if (right.title === '#') return -1;
      return clientNameCollator.compare(left.title, right.title);
    });
}

/** Pure contact presentation; callers own selection, search, navigation and FAB. */
export function CloudContactsList({ contacts, onSelect, actionLabel = 'Открыть клиента' }: {
  contacts: readonly CloudContact[];
  onSelect: (contact: CloudContact) => void;
  actionLabel?: string;
}) {
  return <List dividers={false}>
    {groupClientsForContacts([...contacts]).map((group) => <ListGroup key={group.title}>
      <ListItem title={group.title} groupTitle className="sticky top-0" />
      {group.clients.map((contact) => <ListItem key={contact.relationshipId}
        contacts link chevron={false} media={<CloudContactAvatar contact={contact} />}
        title={contact.displayName} linkComponent="button"
        linkProps={{ type: 'button', 'aria-label': `${actionLabel} ${contact.displayName}`,
          onClick: () => onSelect(contact) }} />)}
    </ListGroup>)}
  </List>;
}
