import { useState } from 'react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CloudContactsList } from '../contacts/CloudContactsList';
import { Button, MezfitBottomSheet, MezfitSearchbar, Text } from '../ui';

export function ProgramClientPicker({ clients, loading, onSelect, onClose }: {
  clients: readonly CloudContact[];
  loading: boolean;
  onSelect: (client: CloudContact) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase('ru-RU');
  const visible = clients.filter((client) => client.displayName.toLocaleLowerCase('ru-RU').includes(search));
  return <MezfitBottomSheet opened label="Выбрать клиента">
    <div className="cloud-plan-client-picker">
      <div className="cloud-plan-title-row">
        <Text variant="headline">Выбрать клиента</Text>
        <Button variant="secondary" onClick={onClose}>Назад</Button>
      </div>
      <label htmlFor="program-client-search"><Text variant="body" className="cloud-plan-search-label">Поиск клиента</Text></label>
      <MezfitSearchbar inputId="program-client-search" placeholder="Поиск клиента"
        glassPreset="modalTuned" glassOptics={false} value={query}
        onChange={(event) => setQuery(event.currentTarget.value)} onClear={() => setQuery('')} />
      {loading ? <Text variant="body">Загружаем клиентов…</Text>
        : visible.length ? <CloudContactsList contacts={visible} onSelect={onSelect} actionLabel="Выбрать клиента" />
          : <Text variant="body">{search ? 'Клиенты не найдены' : 'Нет доступных клиентов'}</Text>}
    </div>
  </MezfitBottomSheet>;
}
