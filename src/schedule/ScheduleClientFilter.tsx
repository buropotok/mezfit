import { useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CloudContactsList } from '../contacts/CloudContactsList';
import { IconButton, MezfitBottomSheet, MezfitSearchbar, Text } from '../ui';

export function ScheduleClientFilter({ opened, clients, loading, selected, onApply, onClose }: {
  opened: boolean;
  clients: readonly CloudContact[];
  loading: boolean;
  selected: readonly string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  return <MezfitBottomSheet opened={opened} label="Фильтр по клиентам" lazyMount>
    {opened ? <ClientSelection clients={clients} loading={loading} initial={selected}
      onApply={onApply} onClose={onClose} /> : null}
  </MezfitBottomSheet>;
}

function ClientSelection({ clients, loading, initial, onApply, onClose }: {
  clients: readonly CloudContact[]; loading: boolean; initial: readonly string[];
  onApply: (ids: string[]) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([...initial]);
  const search = query.trim().toLocaleLowerCase('ru-RU');
  const visible = clients.filter(client => client.displayName.toLocaleLowerCase('ru-RU').includes(search));
  return <section className="schedule-client-filter">
    <header className="schedule-client-filter__header">
      <button type="button" className="schedule-client-filter__apply" onClick={() => onApply(selected)}>
        <Text variant="body">Применить фильтр</Text>
      </button>
      <IconButton label="Закрыть поиск клиентов" onClick={onClose}>✕</IconButton>
    </header>
    <MezfitSearchbar inputId="schedule-client-search" placeholder="Поиск клиента" value={query}
      glassPreset="modalTuned" glassOptics={false}
      onChange={event => setQuery(event.currentTarget.value)} onClear={() => setQuery('')} />
    {loading ? <Text variant="body">Загружаем клиентов…</Text>
      : visible.length ? <CloudContactsList contacts={visible} selectedUserIds={selected}
        actionLabel="Выбрать клиента" onSelect={client => setSelected(current => current.includes(client.userId)
          ? current.filter(id => id !== client.userId) : [...current, client.userId])} />
        : <Text variant="body">{search ? 'Клиенты не найдены' : 'Нет доступных клиентов'}</Text>}
  </section>;
}
