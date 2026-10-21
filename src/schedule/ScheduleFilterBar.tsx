import { useLayoutEffect, useRef, useState } from 'react';
import { Chip } from 'konsta/react';
import type { CloudContact } from '../data/cloud/CloudConnectionsProvider';
import { CloudContactAvatar } from '../contacts/CloudContactAvatar';
import { GlassSurface, Icon, Text } from '../ui';

/** Measure our own chip slots; never inspect Konsta's private DOM. */
export function ScheduleFilterBar({ clients, selected, onRemove, onOpen }: {
  clients: readonly CloudContact[];
  selected: readonly string[];
  onRemove: (id: string) => void;
  onOpen: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const measurements = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(selected.length);
  const people = selected.map(id => ({ id, contact: clients.find(client => client.userId === id) }));
  useLayoutEffect(() => {
    const host = root.current;
    const slots = measurements.current;
    if (!host || !slots) return;
    const measure = () => {
      const available = host.clientWidth - 44;
      if (available <= 0) return;
      const widths = Array.from(slots.children).map(slot => slot.getBoundingClientRect().width);
      if (widths.reduce((sum, width) => sum + width + 8, 0) <= available) {
        setCount(widths.length);
        return;
      }
      const reserved = (more.current?.getBoundingClientRect().width ?? 44) + 8;
      let used = reserved;
      let visible = 0;
      for (const width of widths) {
        if (used + width + 8 > available) break;
        used += width + 8;
        visible++;
      }
      setCount(visible);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    observer?.observe(slots);
    window.addEventListener('resize', measure);
    document.fonts?.addEventListener?.('loadingdone', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      document.fonts?.removeEventListener?.('loadingdone', measure);
    };
  }, [selected, clients]);
  return <div ref={root} className="today-page__filter-bar">
    <button type="button" className="today-page__search-button" aria-label="Поиск клиента" onClick={onOpen}>
      <GlassSurface preset="modalTuned" shape="capsule" className="today-page__search-glass" wrapContent={false}>
        <Icon name="search" style={{ width: 24, height: 24 }} />
      </GlassSurface>
    </button>
    <div className="today-page__filter-chips" aria-label="Выбранные клиенты">
      {people.slice(0, count).map(({ id, contact }) => <Chip key={id} deleteButton
        media={contact ? <CloudContactAvatar contact={contact} className="schedule-client-avatar" /> : undefined}
        onDelete={() => onRemove(id)}>{contact?.displayName ?? 'Клиент'}</Chip>)}
      {count < people.length ? <button type="button" className="today-page__all" onClick={onOpen}>
        <Text variant="body">Все...</Text>
      </button> : null}
    </div>
    <div className="today-page__filter-measure" aria-hidden="true" inert>
      <div ref={measurements} className="today-page__filter-measure-chips">
        {people.map(({ id, contact }) => <span key={id}><Chip deleteButton
          media={contact ? <span className="schedule-client-avatar inline-block" /> : undefined}
        >{contact?.displayName ?? 'Клиент'}</Chip></span>)}
      </div>
      <button ref={more} type="button" className="today-page__all"><Text variant="body">Все...</Text></button>
    </div>
  </div>;
}
