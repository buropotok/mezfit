import { useRef, useState } from 'react';
import { Button } from 'konsta/react';
import { Avatar, IconButton, Text } from './primitives';
import { Icon } from './Icon';
import { DayScheduleEventCard } from './DayScheduleEventCard';
import { LiquidCollapse, type LiquidCollapseBounds } from './LiquidCollapse';

export function LiquidCollapseCatalog() {
  const source = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLButtonElement>(null);
  const [bounds, setBounds] = useState<LiquidCollapseBounds | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const card = <DayScheduleEventCard title="Соколов Андрей" detail="Силовая тренировка"
    media={<Avatar name="Соколов Андрей" />} state={{ startMinutes: 600, durationMinutes: 60, compact: false, editing: false, lifted: false, height: 80 }} />;
  return <section className="ui-kit-stack" aria-label="Liquid Collapse">
    <Text variant="title">Liquid Collapse</Text>
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <IconButton ref={target} label="Отменённые тренировки"><Icon name="trash" /></IconButton>
    </div>
    <div ref={source} style={{ height: 80, visibility: cancelled ? 'hidden' : 'visible' }}>{card}</div>
    <Button rounded tonal onClick={() => {
      if (cancelled) { setCancelled(false); return; }
      const rect = source.current?.getBoundingClientRect();
      if (rect) setBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      setCancelled(true);
    }}>{cancelled ? 'Показать снова' : 'Отменить тренировку'}</Button>
    {bounds ? <LiquidCollapse source={bounds} targetRef={target} onFinished={() => setBounds(null)}>{card}</LiquidCollapse> : null}
  </section>;
}
